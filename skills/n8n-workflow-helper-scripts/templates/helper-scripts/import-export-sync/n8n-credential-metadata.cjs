const fs = require('node:fs');
const path = require('node:path');

function fail(message) {
  const error = new Error(message);
  error.code = 'N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE';
  throw error;
}

function resolved(value) {
  return path.resolve(String(value || ''));
}

function isInside(rootPath, targetPath, allowRoot = false) {
  const root = resolved(rootPath);
  const target = resolved(targetPath);
  if (target === root) return allowRoot;
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function assertNoLinkComponents(targetPath, stopAtPath, allowMissingLeaf = false) {
  const target = resolved(targetPath);
  const stopAt = resolved(stopAtPath);
  if (!isInside(stopAt, target, true)) fail('Credential metadata temporary path escaped the Toolkit-owned root.');

  const parts = path.relative(stopAt, target).split(path.sep).filter(Boolean);
  let current = stopAt;
  const paths = [stopAt];
  for (const part of parts) {
    current = path.join(current, part);
    paths.push(current);
  }

  for (let index = 0; index < paths.length; index += 1) {
    const candidate = paths[index];
    if (!fs.existsSync(candidate)) {
      if (allowMissingLeaf && index === paths.length - 1) continue;
      fail('Credential metadata temporary path is missing or unsafe.');
    }
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) fail('Credential metadata temporary path contains a symlink, junction, or reparse escape.');
    const canonicalCandidate = fs.realpathSync.native(candidate);
    const comparable = (value) => path.normalize(value).replace(/[\\/]+$/, '').toLowerCase();
    if (comparable(canonicalCandidate) !== comparable(path.resolve(candidate))) {
      fail('Credential metadata temporary path contains a symlink, junction, or reparse escape.');
    }
  }
}

function assertExistingAncestorSafe(targetPath) {
  let current = resolved(targetPath);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) fail('Credential metadata temporary path has no safe existing ancestor.');
    current = parent;
  }
  const stat = fs.lstatSync(current);
  const comparable = (value) => path.normalize(value).replace(/[\\/]+$/, '').toLowerCase();
  if (stat.isSymbolicLink() || comparable(fs.realpathSync.native(current)) !== comparable(path.resolve(current))) {
    fail('Credential metadata temporary path contains a symlink, junction, or reparse escape.');
  }
}

function initialiseManagedDirectory(targetDir, managedRoot) {
  const root = resolved(managedRoot);
  const target = resolved(targetDir);
  if (!isInside(root, target)) fail('Credential metadata operation directory must be a strict child of the Toolkit-owned root.');

  assertExistingAncestorSafe(root);
  if (fs.existsSync(root)) assertNoLinkComponents(root, root);
  else fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  assertNoLinkComponents(path.dirname(target), root);
  if (fs.existsSync(target)) fail('Credential metadata operation directory already exists.');
  fs.mkdirSync(target, { recursive: false, mode: 0o700 });
  fs.chmodSync(target, 0o700);
  assertNoLinkComponents(target, root);
  return target;
}

function extractCredentialMetadata(rawExportPath, metadataOutputPath, managedRoot) {
  const root = resolved(managedRoot);
  const rawPath = resolved(rawExportPath);
  const outputPath = resolved(metadataOutputPath);
  if (!isInside(root, rawPath) || !isInside(root, outputPath)) {
    fail('Credential export and metadata output must remain under the Toolkit-owned temporary root.');
  }
  assertNoLinkComponents(rawPath, root);
  assertNoLinkComponents(path.dirname(outputPath), root);
  const rawStat = fs.lstatSync(rawPath);
  if (!rawStat.isFile()) fail('Encrypted credential export must be a regular file.');

  const parsed = JSON.parse(fs.readFileSync(rawPath, 'utf8').replace(/^\uFEFF/, ''));
  if (!Array.isArray(parsed)) fail('Encrypted credential export did not contain a credential array.');
  const metadata = parsed.map((entry) => {
    if (!entry || typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.type !== 'string') {
      fail('Credential export contains an entry without id, name, and type metadata.');
    }
    return { id: entry.id, name: entry.name, type: entry.type };
  });

  fs.writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.chmodSync(outputPath, 0o600);
  return { count: metadata.length, outputPath };
}

function writeEmptyMetadata(metadataOutputPath, managedRoot) {
  const root = resolved(managedRoot);
  const outputPath = resolved(metadataOutputPath);
  if (!isInside(root, outputPath)) fail('Credential metadata output escaped the Toolkit-owned temporary root.');
  assertNoLinkComponents(path.dirname(outputPath), root);
  fs.writeFileSync(outputPath, '[]\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.chmodSync(outputPath, 0o600);
  return { count: 0, outputPath };
}

function cleanupManagedDirectory(targetDir, managedRoot) {
  const root = resolved(managedRoot);
  const target = resolved(targetDir);
  if (!isInside(root, target)) fail('Credential metadata cleanup target must be a strict child of the Toolkit-owned root.');
  if (!fs.existsSync(target)) return;
  assertNoLinkComponents(target, root);
  fs.rmSync(target, { recursive: true, force: false });
}

function usage() {
  console.error('Usage: node n8n-credential-metadata.cjs <init|extract|empty|cleanup> <paths...>');
  process.exit(2);
}

function main(argv = process.argv.slice(2)) {
  const [command, first, second, third] = argv;
  if (command === 'init' && first && second) {
    initialiseManagedDirectory(first, second);
    console.log('Credential metadata temporary directory is ready.');
    return;
  }
  if (command === 'extract' && first && second && third) {
    const result = extractCredentialMetadata(first, second, third);
    console.log(`Extracted safe credential metadata for ${result.count} credential(s).`);
    return;
  }
  if (command === 'empty' && first && second) {
    writeEmptyMetadata(first, second);
    console.log('Recorded an empty credential metadata set.');
    return;
  }
  if (command === 'cleanup' && first && second) {
    cleanupManagedDirectory(first, second);
    console.log('Credential metadata temporary directory was removed.');
    return;
  }
  usage();
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  isInside,
  assertNoLinkComponents,
  assertExistingAncestorSafe,
  initialiseManagedDirectory,
  extractCredentialMetadata,
  writeEmptyMetadata,
  cleanupManagedDirectory,
};
