/**
 * AR Music System - server.js
 * スマホA（サーバー役）で動かすNode.jsサーバー
 * 
 * 機能:
 *   - ARページ（public/）を配信
 *   - WebSocket でplay/stop命令を受信
 *   - mp3をローカルで再生（mpg123 / afplay）
 */

const express    = require('express');
const http       = require('http');
const { WebSocketServer } = require('ws');
const { exec }   = require('child_process');
const path       = require('path');
const fs         = require('fs');

// ──────────────────────────────────────────────
// 設定値（必要に応じて変更してください）
// ──────────────────────────────────────────────
const PORT       = 8443;          // ポート番号
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
// ↑ 必ず長くてランダムな文字列に変えること！

const MUSIC_DIR  = path.join(__dirname, 'music');
const ALLOWED_COMMANDS = ['play', 'stop'];

// track番号の許可範囲（0～この数まで）
const MAX_TRACK_INDEX = 19;

// ──────────────────────────────────────────────
// 音楽ファイルリスト取得
// ──────────────────────────────────────────────
function getMusicList() {
  try {
    return fs.readdirSync(MUSIC_DIR)
      .filter(f => /\.(mp3|m4a|wav|ogg)$/i.test(f))
      .sort();
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────
// 音楽再生プロセス管理
// ──────────────────────────────────────────────
let currentProcess = null;

function stopMusic() {
  if (currentProcess) {
    currentProcess.kill('SIGTERM');
    currentProcess = null;
    console.log('[音楽] 停止しました');
  }
}

function playMusic(trackIndex) {
  stopMusic();

  const list = getMusicList();
  if (list.length === 0) {
    console.error('[エラー] music/ フォルダに音楽ファイルがありません');
    return false;
  }
  if (trackIndex < 0 || trackIndex >= list.length) {
    console.error(`[エラー] トラック番号 ${trackIndex} は存在しません（0〜${list.length - 1}）`);
    return false;
  }

  const file = path.join(MUSIC_DIR, list[trackIndex]);
  console.log(`[音楽] 再生開始: ${list[trackIndex]}`);

  // OS判定してプレイヤーを選択
  // Android (Termux): mpg123
  // iOS / macOS:      afplay
  // Linux:            mpg123 または aplay
  let cmd;
  const platform = process.platform;
  if (platform === 'darwin') {
    cmd = `afplay "${file}"`;
  } else {
    // Android Termux / Linux
    cmd = `mpg123 -q "${file}"`;
  }

  currentProcess = exec(cmd, (err) => {
    if (err && err.signal !== 'SIGTERM') {
      console.error('[再生エラー]', err.message);
    }
    currentProcess = null;
  });

  return true;
}

// ──────────────────────────────────────────────
// Express サーバー設定
// ──────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// staticファイルを配信（public/フォルダ）
app.use(express.static(path.join(__dirname, 'public')));

// 音楽ファイルリストをAPIで返す
app.get('/api/tracks', (req, res) => {
  res.json({ tracks: getMusicList() });
});

// ──────────────────────────────────────────────
// WebSocket サーバー
// ──────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (socket, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`[WS] 接続: ${ip}`);

  // 認証済みフラグ
  let authenticated = false;

  socket.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      console.warn('[WS] JSON解析エラー');
      socket.send(JSON.stringify({ ok: false, error: 'invalid JSON' }));
      return;
    }

    // ── 認証チェック ──────────────────────────
    if (!authenticated) {
      if (msg.token === AUTH_TOKEN) {
        authenticated = true;
        console.log('[WS] 認証成功');
        socket.send(JSON.stringify({ ok: true, event: 'authenticated', tracks: getMusicList() }));
      } else {
        console.warn('[WS] 認証失敗 → 切断');
        socket.send(JSON.stringify({ ok: false, error: 'unauthorized' }));
        socket.close();
      }
      return;
    }

    // ── コマンド処理 ──────────────────────────
    const type = msg.type;

    if (!ALLOWED_COMMANDS.includes(type)) {
      console.warn(`[WS] 不正なコマンド: ${type}`);
      socket.send(JSON.stringify({ ok: false, error: 'unknown command' }));
      return;
    }

    if (type === 'play') {
      const track = parseInt(msg.track, 10);
      if (isNaN(track) || track < 0 || track > MAX_TRACK_INDEX) {
        socket.send(JSON.stringify({ ok: false, error: 'invalid track number' }));
        return;
      }
      const success = playMusic(track);
      socket.send(JSON.stringify({ ok: success, event: 'play', track }));

    } else if (type === 'stop') {
      stopMusic();
      socket.send(JSON.stringify({ ok: true, event: 'stop' }));
    }
  });

  socket.on('close', () => {
    console.log(`[WS] 切断: ${ip}`);
  });

  socket.on('error', (err) => {
    console.error('[WS] エラー:', err.message);
  });
});

// ──────────────────────────────────────────────
// サーバー起動
// ──────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('════════════════════════════════════════');
  console.log('  AR Music System サーバー起動中');
  console.log(`  ポート: ${PORT}`);
  console.log(`  音楽フォルダ: ${MUSIC_DIR}`);
  console.log(`  曲数: ${getMusicList().length} 曲`);
  console.log('════════════════════════════════════════');
  console.log('');
  console.log('次のステップ:');
  console.log('  別ターミナルで → tmole 8443');
  console.log('  表示されたHTTPS URLをスマホBで開く');
  console.log('');
});
