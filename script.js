// ── Default backup entries ──
const defaultEntries = [
  { src: '/home/debian/wordpress/uploads',  dest: 'wordpress/uploads'  }
];

let entryCount = 0;
const entryData = {}; // id -> { src, dest }

function addEntry(src='', dest='') {
  const id = ++entryCount;
  entryData[id] = { src, dest };
  const div = document.createElement('div');
  div.className = 'backup-entry';
  div.id = `entry-${id}`;
  div.innerHTML = `
    <button class="btn-remove" onclick="removeEntry(${id})" title="Supprimer">✕</button>
    <div class="backup-entry-grid">
      <div>
        <label>Chemin source</label>
        <input type="text" value="${src}" placeholder="/chemin/source" oninput="entryData[${id}].src=this.value;gen()">
      </div>
      <div>
        <label>Destination (relatif)</label>
        <input type="text" value="${dest}" placeholder="app/data" oninput="entryData[${id}].dest=this.value;gen()">
      </div>
    </div>
  `;
  document.getElementById('backup-list').appendChild(div);
  gen();
}

function removeEntry(id) {
  delete entryData[id];
  document.getElementById(`entry-${id}`).remove();
  gen();
}

// ── Script generation ──
let lastLines = [];

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function colorize(line) {
  // minimal bash syntax highlighting
  if (line.startsWith('#')) return `<span class="tok-comment">${escHtml(line)}</span>`;
  let s = escHtml(line);
  // strings in quotes
  s = s.replace(/"([^"]*)"/g, (m,g) => `"<span class="tok-str">${g}</span>"`);
  // variable assignments
  s = s.replace(/^(\s*)([\w]+)=/, (m,sp,key) => `${sp}<span class="tok-key">${key}</span>=`);
  // keywords
  s = s.replace(/\b(if|then|else|fi|for|do|done|in|echo|exit|return|function|declare|local|trap)\b/g,
    m => `<span class="tok-kw">${m}</span>`);
  // function calls / builtins
  s = s.replace(/\b(log|mkdir|tar|rm|du|date|echo|exit)\b/g,
    m => `<span class="tok-fn">${m}</span>`);
  // brackets
  s = s.replace(/(\[|\]|\{|\}|\$\(|\))/g,
    m => `<span class="tok-bracket">${m}</span>`);
  return s;
}

function gen() {
  const s3   = document.getElementById('s3remote').value.trim();
  const tmp  = document.getElementById('tmpdir').value.trim();
  const rc   = document.getElementById('rclonepath').value.trim();
  const name = document.getElementById('script-name').value.trim() || 'BACKUP';
  const compress = document.getElementById('opt-compress').checked;
  const dated    = document.getElementById('opt-date').checked;
  const cleanup  = document.getElementById('opt-cleanup').checked;
  const trap_    = document.getElementById('opt-trap').checked;
  const overwrite= document.getElementById('opt-overwrite').value;
  const excludesRaw = document.getElementById('opt-excludes').value;
  const excludes = excludesRaw.split(',').map(s=>s.trim()).filter(Boolean);

  const entries = Object.values(entryData).filter(e => e.src && e.dest);

  // Show/hide excludes field
  document.getElementById('compress-opts').style.display = compress ? '' : 'none';

  let overwFlag = '';
  if (overwrite === 'nocheck')  overwFlag = '--no-check-dest';
  else if (overwrite === 'skip') overwFlag = '--ignore-existing';
  else if (overwrite === 'update') overwFlag = '--update';

  const destExpr = dated ? '"$S3_REMOTE/$DATE/"' : '"$S3_REMOTE/"';

  const lines = [];
  lines.push('#!/bin/bash');
  lines.push('# --- Configuration');
  lines.push(`S3_REMOTE="${s3}"`);
  if (compress || trap_) lines.push(`TEMP_DIR="${tmp}"`);
  if (rc) {
    lines.push(`RCLONE="${rc}"`);
  } else {
    lines.push(`RCLONE=$(command -v rclone)`);
  }
  lines.push('');
  lines.push('# Définir les sources avec leurs destinations');
  lines.push('declare -A BACKUPS=(');
  if (entries.length === 0) {
    lines.push('    # Aucune source configurée');
  } else {
    entries.forEach(e => lines.push(`    ["${e.src}"]="${e.dest}"`));
  }
  lines.push(')');
  lines.push('');
  lines.push('# --- Exécution');
  lines.push('DATE=$(date +%Y-%m-%d_%H-%M-%S)');
  lines.push('START_TIME=$SECONDS');
  lines.push('');
  lines.push('log() {');
  lines.push('    echo "[$(date +%Y-%m-%d\\ %H:%M:%S)] $1"');
  lines.push('}');
  lines.push('');
  lines.push(`log "=== ${name} 🏁 Début des sauvegardes - $DATE ==="`);
  lines.push('');

  if (compress || trap_) {
    lines.push(`mkdir -p "$TEMP_DIR" || { log "🔴 Impossible de créer $TEMP_DIR"; exit 1; }`);
    if (compress) {
      lines.push('RUN_DIR="$TEMP_DIR/$DATE"');
      lines.push(`mkdir -p "$RUN_DIR" || { log "🔴 Impossible de créer $RUN_DIR"; exit 1; }`);
    }
    if (trap_) {
      const cleanTarget = compress ? '"$RUN_DIR"' : '"$TEMP_DIR"';
      lines.push(`trap 'rm -rf ${cleanTarget}' EXIT`);
    }
    lines.push('');
  }

  lines.push('ERRORS=0');
  lines.push('');
  lines.push('for SOURCE in "${!BACKUPS[@]}"; do');
  lines.push('    DEST="${BACKUPS[$SOURCE]}"');
  lines.push('');
  lines.push('    if [ ! -d "$SOURCE" ]; then');
  lines.push('        log "⚠️ $SOURCE n\'existe pas, ignoré"');
  lines.push('        continue');
  lines.push('    fi');
  lines.push('');

  if (compress) {
    lines.push(`    log "⚙️ Compression: $SOURCE → $DEST"`);
    lines.push('    SAFE_NAME=$(echo "$DEST" | tr \'/\' \'-\')');
    lines.push('    ARCHIVE_NAME="${SAFE_NAME}_${DATE}.tar.gz"');
    lines.push('    ARCHIVE_PATH="$RUN_DIR/$ARCHIVE_NAME"');
    lines.push('');
    let tarCmd = '    tar -czf "$ARCHIVE_PATH" \\';
    lines.push(tarCmd);
    lines.push('        -C "$(dirname "$SOURCE")" \\');
    excludes.forEach(ex => lines.push(`        --exclude="${ex}" \\`));
    lines.push('        "$(basename "$SOURCE")" 2>&1');
    lines.push('');
    lines.push('    if [ ${PIPESTATUS[0]} -eq 0 ]; then');
    lines.push('        SIZE=$(du -h "$ARCHIVE_PATH" | cut -f1)');
    lines.push('        log "✅ Archive créée: $ARCHIVE_NAME ($SIZE)"');
    lines.push(`        log "☁️ Upload vers S3..."`);
    const rclineBase = `        $RCLONE copy "$ARCHIVE_PATH" ${destExpr} \\`;
    lines.push(rclineBase);
    lines.push('            --stats 1m \\');
    lines.push('            --stats-one-line \\');
    if (overwFlag) lines.push(`            ${overwFlag}`);
    else lines.push('');
    lines.push('');
    lines.push('        if [ $? -eq 0 ]; then');
    lines.push('            log "✅ Upload réussi: $ARCHIVE_NAME"');
    if (cleanup) {
      lines.push('            rm -f "$ARCHIVE_PATH"');
    }
    lines.push('        else');
    lines.push('            log "🔴 ERREUR upload: $ARCHIVE_NAME"');
    lines.push('            ((ERRORS++))');
    lines.push('        fi');
    lines.push('    else');
    lines.push('        log "🔴 ERREUR compression: $SOURCE"');
    lines.push('        ((ERRORS++))');
    lines.push('    fi');
  } else {
    lines.push(`    log "☁️ Sync: $SOURCE → $DEST"`);
    const rclineBase2 = `    $RCLONE copy "$SOURCE" ${destExpr.replace('$DATE/', '$DATE/$DEST/')} \\`;
    lines.push(rclineBase2);
    lines.push('        --stats 1m \\');
    lines.push('        --stats-one-line \\');
    if (overwFlag) lines.push(`        ${overwFlag}`);
    else lines.push('');
    lines.push('');
    lines.push('    if [ $? -eq 0 ]; then');
    lines.push(`        log "✅ Sync réussi: $SOURCE"`);
    lines.push('    else');
    lines.push(`        log "🔴 ERREUR sync: $SOURCE"`);
    lines.push('        ((ERRORS++))');
    lines.push('    fi');
  }

  lines.push('');
  lines.push('done');
  lines.push('');
  lines.push('ELAPSED_TIME=$(( SECONDS - START_TIME ))');
  lines.push('log "⏱️ Temps écoulé: $ELAPSED_TIME secondes"');
  lines.push('');
  lines.push('if [ $ERRORS -eq 0 ]; then');
  lines.push(`    log "=== ${name} ✅ Toutes les sauvegardes réussies ==="`);
  lines.push('    exit 0');
  lines.push('else');
  lines.push(`    log "=== ${name} ⚠️ \$ERRORS erreur(s) détectée(s) ==="`);
  lines.push('    exit 1');
  lines.push('fi');

  renderScript(lines);
  updateCronScript();
}

function renderScript(lines) {
  const el = document.getElementById('script-output');
  const prev = lastLines;
  lastLines = lines;

  // Find changed line indices
  const changed = new Set();
  const maxLen = Math.max(lines.length, prev.length);
  for (let i = 0; i < maxLen; i++) {
    if (lines[i] !== prev[i]) changed.add(i);
  }

  const html = lines.map((line, i) => {
    const cls = changed.has(i) ? 'line-wrap flash' : 'line-wrap';
    return `<span class="${cls}">${colorize(line)}</span>`;
  }).join('');

  el.innerHTML = html;

  // Re-trigger flash by forcing reflow on changed lines (in case same index flashed before)
  el.querySelectorAll('.flash').forEach(el => {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  });
}

function getScriptText() {
  return lastLines.join('\n');
}

function copyScript() {
  navigator.clipboard.writeText(getScriptText()).then(() => {
    const btn = document.getElementById('btn-copy');
    btn.textContent = '✓ Copié !';
    btn.style.color = 'var(--success)';
    btn.style.borderColor = 'var(--success)';
    setTimeout(() => {
      btn.textContent = '⎘ Copier';
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 2000);
  });
}

function downloadScript() {
  const name = document.getElementById('file-name').value.trim() || 'backup';
  const blob = new Blob([getScriptText()], { type: 'text/x-sh' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '.sh';
  a.click();
}

// ── CRON ──
function pad(n) { return String(n).padStart(2,'0'); }

function initCronSelects() {
  const h = document.getElementById('cron-hour');
  for (let i=0;i<24;i++) {
    const o = document.createElement('option');
    o.value = i; o.textContent = pad(i)+'h';
    if (i===3) o.selected = true;
    h.appendChild(o);
  }
  const m = document.getElementById('cron-min');
  [0,5,10,15,20,25,30,35,40,45,50,55].forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = pad(v);
    m.appendChild(o);
  });
  const md = document.getElementById('cron-mday');
  for (let i=1;i<=28;i++) {
    const o = document.createElement('option');
    o.value = i; o.textContent = i;
    if (i===1) o.selected = true;
    md.appendChild(o);
  }
}

function updateCron() {
  const freq = document.getElementById('cron-freq').value;
  const h    = document.getElementById('cron-hour').value;
  const min  = document.getElementById('cron-min').value;
  const day  = document.getElementById('cron-day').value;
  const mday = document.getElementById('cron-mday').value;
  const cust = document.getElementById('cron-custom').value.trim();
  const fname= document.getElementById('file-name').value.trim() || 'backup';

  document.getElementById('cron-hour-wrap').style.display = freq === 'hourly' || freq === 'custom' ? 'none' : '';
  document.getElementById('cron-min-wrap').style.display  = freq === 'custom' ? 'none' : '';
  document.getElementById('cron-day-wrap').style.display  = freq === 'weekly' ? '' : 'none';
  document.getElementById('cron-mday-wrap').style.display = freq === 'monthly' ? '' : 'none';
  document.getElementById('cron-custom-wrap').style.display = freq === 'custom' ? '' : 'none';

  let expr, desc;
  const rc = document.getElementById('rclonepath').value.trim();
  const scriptPath = `/home/debian/${fname}.sh`;

  if (freq === 'hourly') {
    expr = `${min} * * * *`;
    desc = `Toutes les heures à XX:${pad(min)}`;
  } else if (freq === 'daily') {
    expr = `${min} ${h} * * *`;
    desc = `Tous les jours à ${pad(h)}:${pad(min)}`;
  } else if (freq === 'weekly') {
    const days = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
    expr = `${min} ${h} * * ${day}`;
    desc = `Toutes les semaines le ${days[day]} à ${pad(h)}:${pad(min)}`;
  } else if (freq === 'monthly') {
    expr = `${min} ${h} ${mday} * *`;
    desc = `Tous les mois le ${mday} à ${pad(h)}:${pad(min)}`;
  } else {
    expr = cust;
    desc = 'Expression cron personnalisée';
  }

  const full = `${expr} ${scriptPath} >> /var/log/${fname}.log 2>&1`;
  document.getElementById('cron-line').textContent = full;
  document.getElementById('cron-desc').textContent = desc;
}

function updateCronScript() {
  updateCron(); // refresh script path if file name changed
}

function copyCron() {
  const text = document.getElementById('cron-line').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('btn-cron-copy');
    btn.textContent = '✓ copié';
    btn.style.color = 'var(--success)';
    btn.style.borderColor = 'var(--success)';
    setTimeout(() => {
      btn.textContent = 'copier';
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 2000);
  });
}

// ── Init ──
initCronSelects();
defaultEntries.forEach(e => addEntry(e.src, e.dest));
gen();
updateCron();
