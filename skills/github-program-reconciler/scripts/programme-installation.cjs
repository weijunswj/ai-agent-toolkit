'use strict';

// GitHub access for the cloud sweep: two GitHub App installation tokens, each for one repository.
// The governed repository's token reads and writes its issues and pull requests; the evidence
// store's token reads and writes the state. Every request goes to the token of the repository it
// names (default deny): a REST path outside those two repositories, GraphQL that does not declare
// its repository, and the signed-in user endpoint are refused. Each token reaches gh only through
// the child environment of its own call; nothing is written to disk and no gh sign-in is changed.
const state = require('./programme-state.cjs');

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BOT_LOGIN = /^[A-Za-z0-9-]{1,100}\[bot\]$/;
// Variables that could carry another credential into gh.
const CREDENTIAL_VARIABLES = ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GOVERNED_TOKEN', 'STORE_TOKEN',
  'TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY'];

const refuse = what => new state.ProgrammeError('TOKEN_ROUTE_REFUSED', `The cloud sweep refused ${what}: it may reach only the governed repository and its evidence store.`);

class InstallationTransport {
  constructor({ governed, store, governedToken, storeToken, login, ghPath, run, environment = process.env }) {
    if (!REPOSITORY.test(governed || '') || !REPOSITORY.test(store || '') || governed.toLowerCase() === store.toLowerCase()) {
      throw new state.ProgrammeError('BINDING_INVALID', 'The cloud sweep needs two different repositories: the governed one and its evidence store.');
    }
    if (typeof governedToken !== 'string' || !governedToken || typeof storeToken !== 'string' || !storeToken) {
      throw new state.ProgrammeError('GH_AUTH', 'The cloud sweep has no installation token for each repository.');
    }
    if (!BOT_LOGIN.test(login || '')) throw new state.ProgrammeError('GH_AUTH', 'The cloud sweep was not given the App\'s login.');
    const clean = Object.fromEntries(Object.entries(environment).filter(([name]) => !CREDENTIAL_VARIABLES.includes(name)));
    const transport = token => new state.GitHubTransport({ ghPath, ...(run ? { run } : {}), env: { ...clean, GH_TOKEN: token } });
    this.routes = new Map([[governed.toLowerCase(), transport(governedToken)], [store.toLowerCase(), transport(storeToken)]]);
    this.login = login;
  }

  route(method, path, body) {
    if (path === 'graphql') {
      const variables = body?.variables;
      if (typeof variables?.owner !== 'string' || typeof variables?.name !== 'string') throw refuse('a GraphQL request that does not name its repository');
      return this.routes.get(`${variables.owner}/${variables.name}`.toLowerCase()) || (() => { throw refuse('a GraphQL request for another repository'); })();
    }
    const match = /^repos\/([^/?]+\/[^/?]+)(?:[/?]|$)/.exec(String(path));
    const transport = match && this.routes.get(match[1].toLowerCase());
    if (!transport) throw refuse(`${method} ${String(path).split('?')[0].split('/').slice(0, 3).join('/')}`);
    return transport;
  }

  request(method, path, body, options) { return this.route(method, path, body).request(method, path, body, options); }

  graphql(query, variables) {
    const response = this.request('POST', 'graphql', { query, variables });
    if (response.status !== 200 || response.json?.errors?.length) throw new state.ProgrammeError('GH_GRAPHQL_FAILED', `GraphQL query failed (${response.status}).`);
    return response.json.data;
  }

  // Before any other read: each token must reach exactly its own repository and nothing else.
  verify() {
    for (const [repository, transport] of this.routes) {
      const response = transport.request('GET', 'installation/repositories?per_page=100');
      if (response.status === 401) throw new state.ProgrammeError('GH_AUTH', 'GitHub rejected an installation token.');
      const names = Array.isArray(response.json?.repositories) ? response.json.repositories.map(item => String(item?.full_name || '').toLowerCase()) : [];
      if (response.status !== 200 || response.json.total_count !== 1 || names.length !== 1 || names[0] !== repository) {
        throw new state.ProgrammeError('GH_AUTH', 'An installation token does not reach exactly its one repository.');
      }
    }
    return true;
  }
}

module.exports = { InstallationTransport, CREDENTIAL_VARIABLES };
