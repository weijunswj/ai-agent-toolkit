#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

const configs = [
  {
    id: 'local',
    script: '_projects/n8n/local-setup/_main/templates/local-stack/scripts/n8n-local-menu.ps1',
    header: 'n8n Local Stack',
    entrypoint: '_n8n-local.cmd',
    dockerDirectWarning: 'Do not launch n8n directly from Docker Desktop. Launch it from _n8n-local.cmd instead.',
    dockerDirectDetails: 'Docker Desktop direct launch skips the guided menu, status, update choices, backups, and logs.',
    setupLines: [
      'Compose ngrok setup values in .env:',
      '  NGROK_AUTHTOKEN=<copy from ngrok dashboard>',
      '  NGROK_DOMAIN=<copy host only, no https://>'
    ],
    activeUrlLine: 'The launcher writes the active WEBHOOK_URL into .env.active automatically.',
    tunnelLabel: 'ngrok tunnel',
    tunnelHeaderLabel: 'ngrok Tunnel',
    tunnelShort: 'ngrok',
    tunnelService: 'ngrok',
    startTunnelFunction: 'Start-N8nWithNgrok',
    stopTunnelFunction: 'Stop-NgrokTunnel',
    updateThenStartFunction: 'Update-AllThenStartNgrok',
    updateAfterSwitch: 'StartNgrokAfter',
    stopStackFunction: 'Stop-Stack',
    updateMode: 'apply-update',
    backupAction: 'Show-BackupMenu',
    restoreAction: 'Restore-LocalN8nFromBackupMenu',
    commandDescriptions: {
      start: 'Starts local n8n, or starts n8n with ngrok.',
      stop: 'Stops ngrok only, or stops the local stack.',
      update: 'Pulls images and recreates selected containers automatically.',
      status: 'Shows service state, health, container names, and ports.',
      backup: 'Opens safe manual and automatic backup actions.',
      restore: 'Restores a local database or entities backup after pre-restore backups and approval.'
    },
    preLoop: [
      'Initialize-MenuRuntime',
      '',
      "if (Test-MenuFlag -Name 'library') {",
      '  return',
      '}',
      '',
      "if (Test-MenuFlag -Name 'show-n8n-cli-backup-config') {",
      '  Show-N8nCliBackupConfiguration',
      '  exit 0',
      '}',
      '',
      "if (Test-MenuFlag -Name 'disable-n8n-cli-backups') {",
      '  if (Disable-N8nCliBackupSchedule) { exit 0 }',
      '  exit 1',
      '}',
      '',
      "if ((Test-MenuFlag -Name 'run-n8n-recovery-backup') -or (Test-MenuFlag -Name 'run-n8n-cli-backup')) {",
      "  if (Invoke-N8nCliBackupFromConfig -Scheduled:(Test-MenuFlag -Name 'scheduled')) { exit 0 }",
      '  exit 1',
      '}',
      '',
      'Invoke-LaunchPreflight'
    ]
  },
  {
    id: 'production-cloudflare',
    script: '_projects/n8n/local-setup/_main/templates/production-cloudflare-stack/scripts/n8n-production-cloudflare-menu.ps1',
    header: 'n8n Production Cloudflare Tunnel Stack',
    entrypoint: '_n8n-production-cloudflare.cmd',
    dockerDirectWarning: 'Do not launch production n8n directly from Docker Desktop. Launch it from _n8n-production-cloudflare.cmd instead.',
    dockerDirectDetails: 'Docker Desktop direct launch skips production preflight, status, backups, update choices, and logs.',
    setupLines: [
      'Production requirements:',
      '  Cloudflare public hostname service URL: http://n8n:5678',
      '  No Postgres public ports',
      '  n8n local browser port must be loopback-only',
      '  Back up before updating Postgres',
      '  Back up creates n8n CLI exports, a database dump, manifest, restore notes, and a log'
    ],
    activeUrlLine: 'The launcher writes the active n8n URL into .env.active automatically.',
    tunnelLabel: 'Cloudflare tunnel',
    tunnelHeaderLabel: 'Cloudflare Tunnel',
    tunnelShort: 'Cloudflare',
    tunnelService: 'cloudflared',
    startTunnelFunction: 'Start-N8nWithCloudflare',
    stopTunnelFunction: 'Stop-CloudflareTunnel',
    updateThenStartFunction: 'Update-AllThenStartCloudflare',
    updateAfterSwitch: 'StartCloudflareAfter',
    stopStackFunction: 'Stop-ProductionStack',
    updateMode: 'production-compose',
    backupAction: '[void](Backup-N8nProductionNow)',
    restoreAction: 'Restore-ProductionCloudflareFromBackupMenu',
    commandDescriptions: {
      start: 'Starts localhost only, or opens Start Cloudflare tunnel.',
      stop: 'Stops Cloudflare only, or stops the production stack.',
      update: 'Pulls selected images and recreates selected containers; backs up before database-impacting updates.',
      status: 'Shows service state and image details from Docker Compose.',
      backup: 'Exports workflows and encrypted credentials, dumps Postgres, and writes restore notes.',
      restore: 'Restores a production backup folder or database.sql after pre-restore backup and approval.'
    },
    preLoop: []
  }
];

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function writeHostLines(lines) {
  return lines.map((line, index) => {
    const color = index === 0 ? " -ForegroundColor Cyan" : '';
    return `  Write-Host ${psQuote(line)}${color}`;
  });
}

function functionBlock(name, bodyLines) {
  return [`function ${name} {`, ...bodyLines, '}'].join('\n');
}

function startMenu(config) {
  return functionBlock('Show-StartMenu', [
    "  Write-Header 'Start n8n'",
    "  Write-Host 'Choose how to start:' -ForegroundColor Cyan",
    "  Write-Host '  1. Localhost only'",
    `  Write-Host ${psQuote(`  2. Start ${config.tunnelLabel}`)}`,
    `  Write-Host ${psQuote(`  3. Update all, then start with ${config.tunnelLabel}`)}`,
    "  Write-Host '  4. Cancel'",
    "  Write-Host ''",
    '',
    "  $choice = Read-Host 'Enter a number'",
    '  switch ($choice) {',
    "    '1' { Start-LocalhostOnly }",
    `    '2' { ${config.startTunnelFunction} }`,
    `    '3' { ${config.updateThenStartFunction} }`,
    "    '4' { Write-Warning 'Start cancelled.' }",
    "    default { Write-Warning 'Choose a number from 1 to 4.' }",
    '  }'
  ]);
}

function stopMenu(config) {
  return functionBlock('Show-StopMenu', [
    "  Write-Header 'Stop n8n'",
    "  Write-Host 'Choose what to stop:' -ForegroundColor Cyan",
    `  Write-Host ${psQuote(`  1. n8n + ${config.tunnelLabel}`)}`,
    `  Write-Host ${psQuote(`  2. Stop ${config.tunnelLabel}`)}`,
    "  Write-Host '  3. Cancel'",
    "  Write-Host ''",
    '',
    "  $choice = Read-Host 'Enter a number'",
    '  switch ($choice) {',
    `    '1' { ${config.stopStackFunction} }`,
    `    '2' { ${config.stopTunnelFunction} }`,
    "    '3' { Write-Warning 'Stop cancelled.' }",
    "    default { Write-Warning 'Choose a number from 1 to 3.' }",
    '  }'
  ]);
}

function updateMenu(config) {
  const lines = [
    `  param([switch]$${config.updateAfterSwitch})`,
    '',
    "  Write-Header 'Update'",
    "  Write-Info 'Choose what to update. The launcher pulls images, then recreates selected containers automatically.'",
    "  Write-Host 'Choose what to update:' -ForegroundColor Cyan",
    "  Write-Host '  1. All services'",
    "  Write-Host '  2. n8n only'",
    "  Write-Host '  3. postgres only'",
    `  Write-Host ${psQuote(`  4. ${config.tunnelService} only`)}`,
    "  Write-Host '  5. Cancel'",
    "  Write-Host ''",
    '',
    "  $choice = Read-Host 'Enter a number'"
  ];

  if (config.updateMode === 'apply-update') {
    lines.push(
      '  $selection = @()',
      '  switch ($choice) {',
      "    '1' { $selection = $script:Services }",
      "    '2' { $selection = @('n8n') }",
      "    '3' { $selection = @('postgres') }",
      `    '4' { $selection = @('${config.tunnelService}') }`,
      "    '5' {",
      "      Write-Warning 'Update cancelled.'",
      '      return',
      '    }',
      '    default {',
      "      Write-Warning 'Choose a number from 1 to 5.'",
      '      return',
      '    }',
      '  }',
      '',
      '  Apply-Update -Services $selection',
      '',
      `  if ($${config.updateAfterSwitch}) {`,
      `    ${config.startTunnelFunction}`,
      '  }'
    );
  } else {
    lines.push(
      '  $selected = @()',
      '  $needsBackup = $false',
      '  $needsCloudflarePreflight = $false',
      '  switch ($choice) {',
      `    '1' { $selected = @('postgres', 'n8n', '${config.tunnelService}'); $needsBackup = $true; $needsCloudflarePreflight = $true }`,
      "    '2' { $selected = @('n8n') }",
      "    '3' { $selected = @('postgres'); $needsBackup = $true }",
      `    '4' { $selected = @('${config.tunnelService}'); $needsCloudflarePreflight = $true }`,
      "    '5' {",
      "      Write-Warning 'Update cancelled.'",
      '      return',
      '    }',
      '    default {',
      "      Write-Warning 'Choose a number from 1 to 5.'",
      '      return',
      '    }',
      '  }',
      '',
      '  if ($needsCloudflarePreflight) {',
      '    if (-not (Invoke-SafetyPreflight)) { return }',
      '  } else {',
      '    if (-not (Invoke-BasePreflight)) { return }',
      '  }',
      '  if (-not (Test-DockerReady)) { return }',
      '',
      '  if ($needsBackup) {',
      '    if (-not (Backup-N8nProductionNow -Required)) {',
      '      return',
      '    }',
      '  }',
      '',
      "  [void](Invoke-Compose -Arguments (@('pull') + $selected))",
      "  [void](Invoke-Compose -Arguments (@('up', '-d', '--force-recreate') + $selected))",
      "  [void](Invoke-Compose -Arguments @('ps'))",
      '',
      `  if ($${config.updateAfterSwitch}) {`,
      `    ${config.startTunnelFunction}`,
      '  }'
    );
  }

  return functionBlock('Show-UpdateMenu', lines);
}

function updateThenStart(config) {
  return functionBlock(config.updateThenStartFunction, [
    `  Write-Header ${psQuote(`Update All, Then Start With ${config.tunnelHeaderLabel}`)}`,
    "  Write-Info 'This runs the Update menu first.'",
    `  Show-UpdateMenu -${config.updateAfterSwitch}`
  ]);
}

function commandList(config) {
  return functionBlock('Show-CommandList', [
    "  Write-Header 'Command List'",
    "  Write-Host 'Recommended entrypoint:' -ForegroundColor Cyan",
    `  Write-Host ${psQuote(`  ${config.entrypoint}`)} -ForegroundColor White`,
    "  Write-Host ''",
    `  Write-Host ${psQuote(config.dockerDirectWarning)} -ForegroundColor Yellow`,
    `  Write-Host ${psQuote(config.dockerDirectDetails)} -ForegroundColor Cyan`,
    "  Write-Host ''",
    ...writeHostLines(config.setupLines),
    "  Write-Host ''",
    `  Write-Host ${psQuote(config.activeUrlLine)} -ForegroundColor Cyan`,
    "  Write-Host ''",
    "  Write-Host 'Use the numbered menu options for normal work:' -ForegroundColor Cyan",
    `  Write-CommandListItem -Number '1' -Name 'Start n8n' -Description ${psQuote(config.commandDescriptions.start)}`,
    "  Write-CommandListItem -Number '2' -Name 'Restart n8n' -Description 'Recreates only the n8n app container for non-image .env changes.'",
    `  Write-CommandListItem -Number '3' -Name 'Stop n8n' -Description ${psQuote(config.commandDescriptions.stop)}`,
    `  Write-CommandListItem -Number '4' -Name 'Update' -Description ${psQuote(config.commandDescriptions.update)}`,
    `  Write-CommandListItem -Number '5' -Name 'Show Compose status' -Description ${psQuote(config.commandDescriptions.status)}`,
    "  Write-CommandListItem -Number '6' -Name 'View logs' -Description 'Shows recent logs for all services or one service.'",
    `  Write-CommandListItem -Number '7' -Name 'Back up' -Description ${psQuote(config.commandDescriptions.backup)}`,
    `  Write-CommandListItem -Number '8' -Name 'Advanced / Recovery: Restore local n8n from backup' -Description ${psQuote(config.commandDescriptions.restore)}`,
    "  Write-Host ''",
    "  Write-Host 'Updates are user-approved. After you choose what to update, selected containers are recreated automatically.' -ForegroundColor Yellow"
  ]);
}

function mainMenu(config) {
  return functionBlock('Show-MainMenu', [
    '  Clear-MenuScreen',
    `  Write-Header ${psQuote(config.header)}`,
    '  Show-LaunchStatus',
    "  Write-Host ''",
    "  Write-Host 'Choose an action:' -ForegroundColor Cyan",
    "  Write-Host '  1. Start n8n'",
    "  Write-Host '  2. Restart n8n'",
    "  Write-Host '  3. Stop n8n'",
    "  Write-Host '  4. Update'",
    "  Write-Host '  5. Show Compose status'",
    "  Write-Host '  6. View logs'",
    "  Write-Host '  7. Back up'",
    "  Write-Host '  8. Advanced / Recovery: Restore local n8n from backup'",
    "  Write-Host '  9. Command list'",
    "  Write-Host '  10. Exit'",
    "  Write-Host ''"
  ]);
}

function menuLoop(config) {
  const lines = [
    'while (-not $script:ExitRequested) {',
    '  Show-MainMenu',
    "  $choice = Read-Host 'Enter a number'",
    '',
    '  switch ($choice) {',
    "    '1' { Invoke-MenuAction { Show-StartMenu } }",
    "    '2' { Invoke-MenuAction { Restart-N8n } }",
    "    '3' { Invoke-MenuAction { Show-StopMenu } }",
    "    '4' { Invoke-MenuAction { Show-UpdateMenu } }",
    "    '5' { Invoke-MenuAction { Show-Status } }",
    "    '6' { Invoke-MenuAction { View-LogsMenu } }",
    `    '7' { Invoke-MenuAction { ${config.backupAction} } }`,
    `    '8' { Invoke-MenuAction { ${config.restoreAction} } }`,
    "    '9' { Invoke-MenuAction { Show-CommandList } }",
    "    '10' { Clear-MenuScreen; Write-Success 'Bye.'; $script:ExitRequested = $true }",
    '    default {',
    "      Invoke-MenuAction { Write-Warning 'Choose a number from 1 to 10.' }",
    '    }',
    '  }',
    '}',
    '',
    'exit 0'
  ];
  return lines.join('\n');
}

function findFunctionEnd(text, start) {
  let depth = 0;
  let seenOpen = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') {
      depth += 1;
      seenOpen = true;
    } else if (char === '}') {
      depth -= 1;
      if (seenOpen && depth === 0) {
        let end = index + 1;
        while (text[end] === '\r' || text[end] === '\n') end += 1;
        return end;
      }
    }
  }
  throw new Error('Could not find function end.');
}

function replaceFunction(text, name, replacement) {
  const pattern = new RegExp(`function\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`);
  const match = pattern.exec(text);
  if (!match) throw new Error(`Could not find function ${name}.`);
  const end = findFunctionEnd(text, match.index);
  return `${text.slice(0, match.index)}${replacement}\n\n${text.slice(end)}`;
}

function replaceLoop(text, replacement) {
  const start = text.indexOf('while (-not $script:ExitRequested) {');
  if (start < 0) throw new Error('Could not find menu loop.');
  const exitIndex = text.lastIndexOf('exit 0');
  if (exitIndex < start) throw new Error('Could not find final exit 0.');
  const end = exitIndex + 'exit 0'.length;
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

function generate(config, input) {
  let text = input.replace(/\r\n/g, '\n');
  text = replaceFunction(text, 'Show-StartMenu', startMenu(config));
  text = replaceFunction(text, 'Show-StopMenu', stopMenu(config));
  text = replaceFunction(text, 'Show-UpdateMenu', updateMenu(config));
  text = replaceFunction(text, config.updateThenStartFunction, updateThenStart(config));
  text = replaceFunction(text, 'Show-CommandList', commandList(config));
  text = replaceFunction(text, 'Show-MainMenu', mainMenu(config));
  text = replaceLoop(text, menuLoop(config));
  return text.endsWith('\n') ? text : `${text}\n`;
}

function run() {
  const check = process.argv.includes('--check');
  const write = process.argv.includes('--write');
  if (!check && !write) {
    console.error('Usage: node repo/scripts/generate-n8n-stack-launcher-flow.cjs --check|--write');
    process.exit(2);
  }

  let stale = false;
  for (const config of configs) {
    const target = path.join(repoRoot, config.script);
    const current = fs.readFileSync(target, 'utf8');
    const generated = generate(config, current);
    if (current.replace(/\r\n/g, '\n') !== generated) {
      stale = true;
      if (write) {
        fs.writeFileSync(target, generated, 'utf8');
        console.log(`Updated ${config.script}`);
      } else {
        console.error(`Stale shared launcher flow: ${config.script}`);
      }
    }
  }

  if (check && stale) {
    process.exit(1);
  }

  if (!stale) {
    console.log('n8n shared launcher flow is current.');
  }
}

run();
