import http from 'node:http';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

// 场地纸原图路径通过命令行参数或 MAT_IMAGE_PATH 环境变量传入
const inputPath = process.argv[2] || process.env.MAT_IMAGE_PATH;
if (!inputPath) {
  console.error('用法: node scripts/dev/detect-slots.mjs <场地纸原图路径>');
  process.exit(1);
}
const base64 = fs.readFileSync(inputPath).toString('base64');

const html = `<!DOCTYPE html>
<html><body><canvas id="c" width="1064" height="621"></canvas>
<script>
const img = new Image();
img.onload = () => {
  const c = document.getElementById("c");
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, 1064, 621).data;
  
  // Find top edge and bottom edge of card 1 (around x=90)
  const vert = [];
  for (let y = 0; y < 621; y++) {
    const idx = (y * 1064 + 92) * 4;
    vert.push(Math.round((data[idx] + data[idx+1] + data[idx+2]) / 3));
  }
  
  // Find horizontal coordinates of boxes at y=150
  const horiz = [];
  for (let x = 0; x < 1064; x++) {
    const idx = (150 * 1064 + x) * 4;
    horiz.push(Math.round((data[idx] + data[idx+1] + data[idx+2]) / 3));
  }
  
  fetch("/report", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ horiz, vert })
  });
};
img.src = "data:image/webp;base64,${base64}";
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end(html);
  } else if (req.url === '/report') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const { horiz, vert } = JSON.parse(body);
      
      console.log('--- Horizontal search at y=150 ---');
      const hCandidates = [];
      for (let x = 1; x < 1063; x++) {
        if (horiz[x] > 110 && horiz[x] >= horiz[x-1] && horiz[x] >= horiz[x+1]) {
          hCandidates.push(x);
        }
      }
      console.log('h peaks:', hCandidates);
      
      console.log('--- Vertical search at x=92 ---');
      const vCandidates = [];
      for (let y = 1; y < 620; y++) {
        if (vert[y] > 100 && vert[y] >= vert[y-1] && vert[y] >= vert[y+1]) {
          vCandidates.push(y);
        }
      }
      console.log('v peaks:', vCandidates);
      
      res.writeHead(200); res.end('ok');
      server.close();
      process.exit(0);
    });
  }
});

server.listen(48926, () => {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  execSync(`"${chromePath}" --headless=new --disable-gpu http://localhost:48926`, { timeout: 10000 });
});
