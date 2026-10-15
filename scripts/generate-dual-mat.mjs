import fs from 'node:fs';
import http from 'node:http';
import { execSync } from 'node:child_process';

// 场地纸原图路径通过命令行参数或 MAT_IMAGE_PATH 环境变量传入
const inputPath = process.argv[2] || process.env.MAT_IMAGE_PATH;
if (!inputPath) {
  console.error('用法: node scripts/generate-dual-mat.mjs <场地纸原图路径>');
  process.exit(1);
}
const imgData = fs.readFileSync(inputPath);
const base64 = imgData.toString('base64');

const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<canvas id="c_full" width="1064" height="1242"></canvas>
<canvas id="c_arena" width="1064" height="600"></canvas>
<script>
const img = new Image();
img.onload = () => {
  // 1. Full dual mat (1064 x 1242)
  const cFull = document.getElementById("c_full");
  const ctxFull = cFull.getContext("2d");
  
  // Top half: rotated 180 degrees
  ctxFull.save();
  ctxFull.translate(1064, 621);
  ctxFull.rotate(Math.PI);
  ctxFull.drawImage(img, 0, 0, 1064, 621);
  ctxFull.restore();
  
  // Bottom half: normal orientation
  ctxFull.drawImage(img, 0, 621, 1064, 621);
  const fullWebp = cFull.toDataURL("image/webp", 0.95);

  // 2. Focused Widescreen Arena Mat (1064 x 600)
  // Designed so the 5v5 frontline role slots and deck/graveyard zones
  // align 100.00% with the standard card proportion 626:873 (126px x 176px).
  const cArena = document.getElementById("c_arena");
  const ctxArena = cArena.getContext("2d");
  
  // Fill dark cybernetic backdrop
  ctxArena.fillStyle = "#07090e";
  ctxArena.fillRect(0, 0, 1064, 600);

  // Top half (Opponent arena: y=0..300)
  // Take original image cropped around battle slots (y: 0..300), rotated 180 degrees
  ctxArena.save();
  ctxArena.translate(1064, 300);
  ctxArena.rotate(Math.PI);
  // Source: x: 0..1064, y: 0..300 -> Dest: x: 0..1064, y: 0..300
  ctxArena.drawImage(img, 0, 0, 1064, 300, 0, 0, 1064, 300);
  ctxArena.restore();
  
  // Bottom half (Player arena: y=300..600)
  // Source: x: 0..1064, y: 0..300 -> Dest: x: 0..1064, y: 300..600
  ctxArena.drawImage(img, 0, 0, 1064, 300, 0, 300, 1064, 300);

  // Tactical Midfield Energy Clash Divider (y=235..365)
  // Frosted dark cybernetic band to cleanly cover the redundant static erosion counters
  const gradMid = ctxArena.createLinearGradient(0, 235, 0, 365);
  gradMid.addColorStop(0, "rgba(7, 9, 14, 0.2)");
  gradMid.addColorStop(0.2, "rgba(7, 9, 14, 0.88)");
  gradMid.addColorStop(0.5, "rgba(5, 12, 20, 0.92)");
  gradMid.addColorStop(0.8, "rgba(7, 9, 14, 0.88)");
  gradMid.addColorStop(1, "rgba(7, 9, 14, 0.2)");
  ctxArena.fillStyle = gradMid;
  ctxArena.fillRect(0, 235, 1064, 130);

  // Subtle cyan neon glow band in midfield
  const neonGlow = ctxArena.createLinearGradient(0, 290, 0, 310);
  neonGlow.addColorStop(0, "transparent");
  neonGlow.addColorStop(0.5, "rgba(0, 240, 255, 0.2)");
  neonGlow.addColorStop(1, "transparent");
  ctxArena.fillStyle = neonGlow;
  ctxArena.fillRect(0, 290, 1064, 20);

  // Center energy line
  ctxArena.strokeStyle = "rgba(0, 240, 255, 0.7)";
  ctxArena.lineWidth = 1.5;
  ctxArena.setLineDash([16, 8]);
  ctxArena.beginPath();
  ctxArena.moveTo(120, 300);
  ctxArena.lineTo(944, 300);
  ctxArena.stroke();
  ctxArena.setLineDash([]);

  // Midfield clash HUD text
  ctxArena.fillStyle = "rgba(0, 240, 255, 0.75)";
  ctxArena.font = "bold 11px monospace";
  ctxArena.textAlign = "center";
  ctxArena.textBaseline = "middle";
  ctxArena.fillText("<< TACTICAL ENGAGEMENT ZONE >>", 532, 300);

  // Draw cybernetic precision slot frames on the mat texture
  // Standard card size on mat: 126px width x 176px height (Aspect 626:873)
  const SLOT_WIDTH = 126;
  const SLOT_HEIGHT = 176;
  const CORNER_LEN = 14;

  const playerSlotXs = [36, 210, 383, 556, 729, 902]; // 0..4 roles, 5 deck/GY
  const opponentSlotXs = [36, 209, 382, 555, 728, 902]; // 0 deck/GY, 1..5 roles

  function drawCyberSlot(x, y, isOpponent) {
    ctxArena.save();
    // 1. Soft gradient mask for the excess 22px from the old 198px box
    if (isOpponent) {
      // Old box top was y=26..48: fade out smoothly
      const gMask = ctxArena.createLinearGradient(x, 18, x, 52);
      gMask.addColorStop(0, "rgba(7, 9, 14, 0.4)");
      gMask.addColorStop(0.4, "rgba(7, 9, 14, 0.92)");
      gMask.addColorStop(1, "rgba(7, 9, 14, 0.92)");
      ctxArena.fillStyle = gMask;
      ctxArena.fillRect(x - 4, 18, SLOT_WIDTH + 8, 34);
    } else {
      // Old box bottom was y=552..576: fade out smoothly
      const gMask = ctxArena.createLinearGradient(x, 550, x, 584);
      gMask.addColorStop(0, "rgba(7, 9, 14, 0.92)");
      gMask.addColorStop(0.6, "rgba(7, 9, 14, 0.92)");
      gMask.addColorStop(1, "rgba(7, 9, 14, 0.4)");
      ctxArena.fillStyle = gMask;
      ctxArena.fillRect(x - 4, 550, SLOT_WIDTH + 8, 34);
    }

    // 2. High-tech sci-fi card bed for the 126x176 standard card slot
    const grad = ctxArena.createLinearGradient(x, y, x, y + SLOT_HEIGHT);
    grad.addColorStop(0, isOpponent ? "rgba(255, 42, 95, 0.2)" : "rgba(0, 240, 255, 0.2)");
    grad.addColorStop(0.5, isOpponent ? "rgba(255, 42, 95, 0.04)" : "rgba(0, 240, 255, 0.04)");
    grad.addColorStop(1, isOpponent ? "rgba(255, 42, 95, 0.14)" : "rgba(0, 240, 255, 0.14)");
    ctxArena.fillStyle = grad;
    ctxArena.fillRect(x, y, SLOT_WIDTH, SLOT_HEIGHT);

    // 3. Cybernetic frame border matching 626:873
    ctxArena.strokeStyle = isOpponent ? "rgba(255, 80, 120, 0.7)" : "rgba(0, 240, 255, 0.7)";
    ctxArena.lineWidth = 1.2;
    ctxArena.strokeRect(x, y, SLOT_WIDTH, SLOT_HEIGHT);

    // 4. Tech corner brackets
    ctxArena.strokeStyle = isOpponent ? "rgba(255, 130, 170, 1.0)" : "rgba(0, 240, 255, 1.0)";
    ctxArena.lineWidth = 2.5;

    // TL
    ctxArena.beginPath();
    ctxArena.moveTo(x, y + CORNER_LEN);
    ctxArena.lineTo(x, y);
    ctxArena.lineTo(x + CORNER_LEN, y);
    ctxArena.stroke();

    // TR
    ctxArena.beginPath();
    ctxArena.moveTo(x + SLOT_WIDTH - CORNER_LEN, y);
    ctxArena.lineTo(x + SLOT_WIDTH, y);
    ctxArena.lineTo(x + SLOT_WIDTH, y + CORNER_LEN);
    ctxArena.stroke();

    // BL
    ctxArena.beginPath();
    ctxArena.moveTo(x, y + SLOT_HEIGHT - CORNER_LEN);
    ctxArena.lineTo(x, y + SLOT_HEIGHT);
    ctxArena.lineTo(x + CORNER_LEN, y + SLOT_HEIGHT);
    ctxArena.stroke();

    // BR
    ctxArena.beginPath();
    ctxArena.moveTo(x + SLOT_WIDTH - CORNER_LEN, y + SLOT_HEIGHT);
    ctxArena.lineTo(x + SLOT_WIDTH, y + SLOT_HEIGHT);
    ctxArena.lineTo(x + SLOT_WIDTH, y + SLOT_HEIGHT - CORNER_LEN);
    ctxArena.stroke();

    // 5. Central crosshair target
    const cx = x + SLOT_WIDTH / 2;
    const cy = y + SLOT_HEIGHT / 2;
    ctxArena.strokeStyle = isOpponent ? "rgba(255, 100, 140, 0.45)" : "rgba(0, 240, 255, 0.45)";
    ctxArena.lineWidth = 1;
    ctxArena.beginPath();
    ctxArena.arc(cx, cy, 16, 0, Math.PI * 2);
    ctxArena.stroke();

    ctxArena.beginPath();
    ctxArena.moveTo(cx - 22, cy);
    ctxArena.lineTo(cx + 22, cy);
    ctxArena.moveTo(cx, cy - 22);
    ctxArena.lineTo(cx, cy + 22);
    ctxArena.stroke();

    ctxArena.restore();
  }

  // Draw 6 Opponent frames (top: y=48, height=176, bottom=224)
  opponentSlotXs.forEach(x => drawCyberSlot(x, 48, true));

  // Draw 6 Player frames (bottom: y=376, height=176, bottom=552)
  playerSlotXs.forEach(x => drawCyberSlot(x, 376, false));

  const arenaWebp = cArena.toDataURL("image/webp", 0.95);
  const arenaPng = cArena.toDataURL("image/png");

  fetch("/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullWebp, arenaWebp, arenaPng })
  }).then(() => window.close());
};
img.src = "data:image/webp;base64,${base64}";
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else if (req.url === '/save' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const json = JSON.parse(body);
        const fullBuf = Buffer.from(json.fullWebp.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        const arenaBuf = Buffer.from(json.arenaWebp.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        const arenaPngBuf = Buffer.from(json.arenaPng.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        
        fs.writeFileSync('apps/web/public/field-dual.webp', fullBuf);
        fs.writeFileSync('apps/web/public/field-arena.webp', arenaBuf);
        fs.writeFileSync('apps/web/public/field-arena.png', arenaPngBuf);
        fs.writeFileSync('apps/web/public/field.webp', arenaBuf); // Use the arena mat as default field mat!
        
        console.log('✓ Successfully generated:');
        console.log('- apps/web/public/field-dual.webp (Full 1064x1242)');
        console.log('- apps/web/public/field-arena.webp (Widescreen 1064x600 arena mat)');
        console.log('- apps/web/public/field.webp (Updated default)');
        
        res.writeHead(200);
        res.end('ok');
        setTimeout(() => {
          server.close();
          process.exit(0);
        }, 500);
      } catch (err) {
        console.error('Error saving image:', err);
        res.writeHead(500);
        res.end('err');
        process.exit(1);
      }
    });
  }
});

server.listen(48924, () => {
  console.log('Launching headless Chrome to render arena mats...');
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  try {
    execSync(`"${chromePath}" --headless=new --disable-gpu http://localhost:48924`, { timeout: 20000 });
  } catch {}
});
