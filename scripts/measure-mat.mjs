import http from 'node:http';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const inputPath = 'C:\\Users\\IkemiyaSouta\\Desktop\\758754174f6448f1b99e2f7cd4f7a05120260704.webp';
const base64 = fs.readFileSync(inputPath).toString('base64');

const html = `<!DOCTYPE html>
<html><body><canvas id="c" width="1064" height="621"></canvas>
<script>
const img = new Image();
img.onload = () => {
  const c = document.getElementById("c");
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  
  // Let's find the card slot rectangles.
  // Card slot frames are bright glowing borders.
  // Let's scan along several lines to find the exact bounding boxes of the 6 slots at top:
  // Slot Y is roughly 70..260.
  // Let's scan x from 0 to 1063 at y = 160:
  const row160 = [];
  const imgData160 = ctx.getImageData(0, 160, 1064, 1).data;
  for (let x = 0; x < 1064; x++) {
    const r = imgData160[x * 4];
    const g = imgData160[x * 4 + 1];
    const b = imgData160[x * 4 + 2];
    row160.push({ x, b: (r + g + b) / 3 });
  }

  // Also let's inspect the bounding box of slot 1:
  // Scan columns around x = 30..170 at y = 70..260
  const slot1Data = ctx.getImageData(20, 60, 160, 210).data;
  // slot 1 is in rect (20, 60, 160, 210)
  // Let's find horizontal borders (minY, maxY) and vertical borders (minX, maxX)
  // for Slot 1:
  
  // And let's find the card slot borders across the whole top row:
  const horizontalBoxes = [];
  // Sample every column from 0 to 1063, check vertical border presence
  // A vertical border of a card has bright pixels along y = 100..200
  const colBright = [];
  for (let x = 0; x < 1064; x++) {
    const colData = ctx.getImageData(x, 100, 1, 100).data;
    let sum = 0;
    for (let i = 0; i < 100; i++) {
      sum += (colData[i * 4] + colData[i * 4 + 1] + colData[i * 4 + 2]) / 3;
    }
    colBright.push(Math.round(sum / 100));
  }

  // Row brightness along y from 50 to 300 at x = 90 (middle of slot 1)
  const rowBright = [];
  for (let y = 50; y < 300; y++) {
    const pixel = ctx.getImageData(90, y, 1, 1).data;
    rowBright.push({ y, b: Math.round((pixel[0] + pixel[1] + pixel[2]) / 3) });
  }

  // Row brightness along y from 50 to 300 at x = 750 (middle of slot 5)
  const rowBright750 = [];
  for (let y = 50; y < 300; y++) {
    const pixel = ctx.getImageData(750, y, 1, 1).data;
    rowBright750.push({ y, b: Math.round((pixel[0] + pixel[1] + pixel[2]) / 3) });
  }

  fetch("/report", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ colBright, rowBright, rowBright750 })
  }).then(() => window.close());
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
      const data = JSON.parse(body);
      console.log('--- Slot 1 & 5 Vertical Border Peaks (Y) ---');
      const peaks90 = data.rowBright.filter((p, i, arr) => {
        if (i === 0 || i === arr.length - 1) return false;
        return p.b > 75 && p.b >= arr[i-1].b && p.b >= arr[i+1].b;
      });
      console.log('Slot 1 Y peaks (around x=90):', peaks90);

      const peaks750 = data.rowBright750.filter((p, i, arr) => {
        if (i === 0 || i === arr.length - 1) return false;
        return p.b > 75 && p.b >= arr[i-1].b && p.b >= arr[i+1].b;
      });
      console.log('Slot 5 Y peaks (around x=750):', peaks750);

      console.log('--- Column brightness (X peaks) ---');
      const xPeaks = [];
      for (let x = 2; x < 1062; x++) {
        if (data.colBright[x] > 70 && data.colBright[x] > data.colBright[x-1] && data.colBright[x] >= data.colBright[x+1]) {
          xPeaks.push({ x, b: data.colBright[x] });
        }
      }
      console.log('X peaks along y=100..200:', xPeaks);

      res.writeHead(200); res.end('ok');
      server.close();
      process.exit(0);
    });
  }
});

server.listen(48928, () => {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  execSync(`"${chromePath}" --headless=new --disable-gpu http://localhost:48928`, { timeout: 10000 });
});
