import http from 'node:http';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const originalPath = 'C:\\Users\\IkemiyaSouta\\Desktop\\758754174f6448f1b99e2f7cd4f7a05120260704.webp';
const arenaPath = 'apps/web/public/field-arena.png';

const origBase64 = fs.readFileSync(originalPath).toString('base64');
const arenaBase64 = fs.readFileSync(arenaPath).toString('base64');

const html = `<!DOCTYPE html>
<html><body>
<canvas id="cOrig" width="1064" height="621"></canvas>
<canvas id="cArena" width="1064" height="600"></canvas>
<script>
async function run() {
  const loadImg = (b64, type) => new Promise(res => {
    const img = new Image();
    img.onload = () => res(img);
    img.src = 'data:image/' + type + ';base64,' + b64;
  });

  const imgOrig = await loadImg('${origBase64}', 'webp');
  const imgArena = await loadImg('${arenaBase64}', 'png');

  const cOrig = document.getElementById('cOrig');
  const ctxOrig = cOrig.getContext('2d');
  ctxOrig.drawImage(imgOrig, 0, 0);

  const cArena = document.getElementById('cArena');
  const ctxArena = cArena.getContext('2d');
  ctxArena.drawImage(imgArena, 0, 0);

  // Measure card frames in cOrig
  // Card frames have bright borders with rounded corners and crosshairs in the center.
  // In cOrig, let's scan across y = 150 for the 6 boxes:
  const origData = ctxOrig.getImageData(0, 0, 1064, 621).data;
  const arenaData = ctxArena.getImageData(0, 0, 1064, 600).data;

  function getPixel(data, width, x, y) {
    const idx = (y * width + x) * 4;
    return (data[idx] + data[idx+1] + data[idx+2]) / 3;
  }

  // Scan row at y=160 in orig
  const row160 = [];
  for (let x = 0; x < 1064; x++) {
    row160.push(Math.round(getPixel(origData, 1064, x, 160)));
  }

  // Find the exact box borders in orig:
  // For each of the boxes, let's find left, right, top, bottom:
  // Let's sample a few columns:
  // Box 1: x around 35..160
  // Box 2: x around 195..320
  // Box 3: x around 355..480
  // Box 4: x around 555..680
  // Box 5: x around 730..855
  // Box 6: x around 900..1025

  // Let's find top and bottom for Box 1 (sample x=98):
  const col98 = [];
  for (let y = 50; y < 300; y++) {
    col98.push({ y, b: Math.round(getPixel(origData, 1064, 98, y)) });
  }

  // In arena, let's also scan:
  // Bottom half (Player):
  // Let's find vertical brightness at x=98 for y=300..590:
  const arenaCol98 = [];
  for (let y = 300; y < 600; y++) {
    arenaCol98.push({ y, b: Math.round(getPixel(arenaData, 1064, 98, y)) });
  }

  // Top half (Opponent):
  // Let's find vertical brightness at x=966 (mirror of 98) for y=0..300:
  const arenaCol966 = [];
  for (let y = 0; y < 300; y++) {
    arenaCol966.push({ y, b: Math.round(getPixel(arenaData, 1064, 966, y)) });
  }

  fetch('/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ col98, arenaCol98, arenaCol966 })
  }).then(() => window.close());
}
run();
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } else if (req.url === '/report') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const { col98, arenaCol98, arenaCol966 } = JSON.parse(body);
      console.log('--- Original image col98 peaks: ---');
      const origPeaks = col98.filter((p, i, a) => i > 0 && i < a.length-1 && p.b > 70 && p.b >= a[i-1].b && p.b >= a[i+1].b);
      console.log(origPeaks);

      console.log('--- Arena image col98 (bottom half) peaks: ---');
      const arenaPeaks = arenaCol98.filter((p, i, a) => i > 0 && i < a.length-1 && p.b > 70 && p.b >= a[i-1].b && p.b >= a[i+1].b);
      console.log(arenaPeaks);

      console.log('--- Arena image col966 (top half) peaks: ---');
      const arenaTopPeaks = arenaCol966.filter((p, i, a) => i > 0 && i < a.length-1 && p.b > 70 && p.b >= a[i-1].b && p.b >= a[i+1].b);
      console.log(arenaTopPeaks);

      res.writeHead(200); res.end('ok');
      server.close();
      process.exit(0);
    });
  }
});

server.listen(48932, () => {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  execSync(`"${chromePath}" --headless=new --disable-gpu http://localhost:48932`, { timeout: 10000 });
});
