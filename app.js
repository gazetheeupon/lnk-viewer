import { parseLnk } from './lnk-parser.js';

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const status = document.getElementById('status');
const results = document.getElementById('results');
const exportRow = document.getElementById('exportRow');

let lastResult = null;
let lastFileName = '';

function fmtDate(d) {
  return d ? d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC') : '(not set)';
}

function row(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return `<tr><td>${label}</td><td>${escapeHtml(String(value))}</td></tr>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render(result) {
  const h = result.header;
  const li = result.linkInfo;
  const s = result.strings;

  let html = '';

  if (result.warnings.length) {
    html += '<div class="warn">' + result.warnings.map(escapeHtml).join('<br>') + '</div>';
  }

  html += '<h2>Target</h2><table>';
  html += row('Full target path', li && li.fullPath);
  html += row('Name', s.name);
  html += row('Relative path', s.relativePath);
  html += row('Working directory', s.workingDir);
  html += row('Arguments', s.commandLineArguments);
  html += row('Icon location', s.iconLocation);
  html += row('Icon index', h.iconIndex);
  html += row('Window state', h.showCommand);
  html += row('Hotkey', h.hotkey);
  html += row('Run as administrator', h.runAsAdministrator ? 'Yes' : null);
  html += '</table>';

  if (li && li.volume) {
    html += '<h2>Volume the target was on</h2><table>';
    html += row('Drive type', li.volume.driveType);
    html += row('Volume serial number', li.volume.driveSerialNumber);
    html += row('Volume label', li.volume.volumeLabel);
    html += '</table>';
  }
  if (li && li.network) {
    html += '<h2>Network location</h2><table>';
    html += row('Network share', li.network.netName);
    html += row('Mapped device', li.network.deviceName);
    html += '</table>';
  }

  html += '<h2>File info recorded in the shortcut</h2><table>';
  html += row('Target file size', h.targetFileSize != null ? h.targetFileSize.toLocaleString() + ' bytes' : null);
  html += row('Target attributes', h.fileAttributes.join(', ') || '(none)');
  html += row('Created', fmtDate(h.creationTime));
  html += row('Last accessed', fmtDate(h.accessTime));
  html += row('Last written', fmtDate(h.writeTime));
  html += '</table>';

  const tracker = result.extraBlocks.find((b) => b.machineId);
  if (tracker) {
    html += '<h2>Origin machine (Tracker block)</h2><table>';
    html += row('Machine name', tracker.machineId);
    html += row('Volume Droid ID', tracker.droidVolumeId);
    html += row('File Droid ID', tracker.droidFileId);
    html += '</table>';
  }

  const envBlocks = result.extraBlocks.filter((b) => b.targetAnsi !== undefined);
  envBlocks.forEach((b) => {
    html += `<h2>${escapeHtml(b.name)}</h2><table>`;
    html += row('Path (with env. vars expanded)', b.targetUnicode);
    html += '</table>';
  });

  const knownFolder = result.extraBlocks.find((b) => b.knownFolderId);
  if (knownFolder) {
    html += '<h2>Known folder reference</h2><table>';
    html += row('Known folder', knownFolder.knownFolderName || knownFolder.knownFolderId);
    html += row('Folder GUID', knownFolder.knownFolderId);
    html += '</table>';
  }

  if (result.targetIdList) {
    html += '<h2>Shell item ID list</h2><table>';
    html += row('Items', result.targetIdList.itemCount);
    html += row('Raw size', result.targetIdList.byteSize + ' bytes');
    html += '</table><p class="note">This list is how Explorer resolves the icon and target without the path strings above; RunLocal shows it only as a byte/item count.</p>';
  }

  const otherBlocks = result.extraBlocks.filter((b) => !b.machineId && b.targetAnsi === undefined && !b.knownFolderId);
  if (otherBlocks.length) {
    html += '<h2>Other data blocks found</h2><table>';
    otherBlocks.forEach((b) => {
      html += row(b.name, b.signature + ', ' + b.size + ' bytes' + (b.layerName ? ' — ' + b.layerName : '') + (b.codePage ? ' — code page ' + b.codePage : ''));
    });
    html += '</table>';
  }

  results.innerHTML = html;
}

function toPlainObject(result) {
  return {
    target: {
      fullPath: result.linkInfo && result.linkInfo.fullPath,
      name: result.strings.name,
      relativePath: result.strings.relativePath,
      workingDir: result.strings.workingDir,
      arguments: result.strings.commandLineArguments,
      iconLocation: result.strings.iconLocation,
      iconIndex: result.header.iconIndex,
      windowState: result.header.showCommand,
      hotkey: result.header.hotkey,
      runAsAdministrator: result.header.runAsAdministrator,
    },
    volume: result.linkInfo && result.linkInfo.volume,
    network: result.linkInfo && result.linkInfo.network,
    fileInfo: {
      targetFileSize: result.header.targetFileSize,
      attributes: result.header.fileAttributes,
      created: result.header.creationTime,
      accessed: result.header.accessTime,
      written: result.header.writeTime,
    },
    extraBlocks: result.extraBlocks,
    warnings: result.warnings,
  };
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

document.getElementById('exportJsonBtn').addEventListener('click', () => {
  if (!lastResult) return;
  download(lastFileName + '.json', JSON.stringify(toPlainObject(lastResult), null, 2), 'application/json');
});

document.getElementById('exportCsvBtn').addEventListener('click', () => {
  if (!lastResult) return;
  const obj = toPlainObject(lastResult);
  const rows = [['field', 'value']];
  function flatten(prefix, v) {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) { rows.push([prefix, v.join('; ')]); return; }
    if (typeof v === 'object') { Object.entries(v).forEach(([k, vv]) => flatten(prefix ? prefix + '.' + k : k, vv)); return; }
    rows.push([prefix, String(v)]);
  }
  flatten('', obj);
  const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
  download(lastFileName + '.csv', csv, 'text/csv');
});

async function handleFile(file) {
  if (!file) return;
  status.textContent = 'Parsing ' + file.name + '...';
  results.innerHTML = '';
  exportRow.style.display = 'none';
  try {
    const buf = await file.arrayBuffer();
    const result = parseLnk(buf);
    lastResult = result;
    lastFileName = file.name.replace(/\.[^.]+$/, '');
    render(result);
    status.textContent = 'Parsed ' + file.name + '.';
    exportRow.style.display = 'flex';
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
    console.error(err);
  }
}

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('drag'); })
);
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); })
);
dropzone.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));
