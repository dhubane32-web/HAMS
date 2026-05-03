const canvas = document.getElementById('arena');
const ctx = canvas.getContext('2d');

const scoreEl = document.getElementById('score');
const healthEl = document.getElementById('health');
const levelEl = document.getElementById('level');

const startBtn = document.getElementById('startBtn');
const addFireBtn = document.getElementById('addFireBtn');
const addRainBtn = document.getElementById('addRainBtn');

const world = {
  running: false,
  score: 0,
  health: 100,
  level: 1,
  lastTime: 0,
  waveTimer: 0,
  mouse: { x: canvas.width / 2, y: canvas.height / 2 },
  keys: {},
  cameraShake: 0
};

const player = {
  x: canvas.width / 2,
  y: canvas.height / 2,
  radius: 15,
  speed: 220,
  fireRateMs: 140,
  bulletSpeed: 560,
  bulletDamage: 1,
  ammoMod: 1,
  lastShot: 0,
  facing: 0,
  dashCd: 0
};

const bullets = [];
const enemies = [];
const particles = [];
const pickups = [];

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function resetGame() {
  world.running = true;
  world.score = 0;
  world.health = 100;
  world.level = 1;
  world.waveTimer = 0;
  world.cameraShake = 0;

  player.x = canvas.width / 2;
  player.y = canvas.height / 2;
  player.fireRateMs = 140;
  player.bulletDamage = 1;
  player.speed = 220;
  player.lastShot = 0;
  player.dashCd = 0;

  bullets.length = 0;
  enemies.length = 0;
  particles.length = 0;
  pickups.length = 0;

  spawnWave(1);
  updateHud();
}

function updateHud() {
  scoreEl.textContent = String(world.score);
  healthEl.textContent = String(Math.max(0, Math.round(world.health)));
  levelEl.textContent = String(world.level);
}

function spawnEnemy(type = 'grunt') {
  const edge = Math.floor(rand(0, 4));
  let x = 0;
  let y = 0;
  if (edge === 0) {
    x = rand(0, canvas.width);
    y = -30;
  } else if (edge === 1) {
    x = canvas.width + 30;
    y = rand(0, canvas.height);
  } else if (edge === 2) {
    x = rand(0, canvas.width);
    y = canvas.height + 30;
  } else {
    x = -30;
    y = rand(0, canvas.height);
  }

  const base = {
    x,
    y,
    vx: 0,
    vy: 0,
    type,
    r: type === 'tank' ? 20 : 14,
    hp: type === 'tank' ? 5 + world.level : 2 + Math.floor(world.level * 0.6),
    speed: type === 'tank' ? 45 + world.level * 2 : 65 + world.level * 3,
    color: type === 'tank' ? '#ef4444' : '#f97316'
  };
  enemies.push(base);
}

function spawnWave(level) {
  const count = 4 + level * 2;
  for (let i = 0; i < count; i += 1) {
    spawnEnemy(i % 5 === 0 ? 'tank' : 'grunt');
  }
}

function spawnPickup() {
  const kind = Math.random() < 0.5 ? 'heal' : 'rapid';
  pickups.push({
    x: rand(50, canvas.width - 50),
    y: rand(50, canvas.height - 50),
    r: 11,
    kind,
    ttl: 12000
  });
}

function addExplosion(x, y, color = '#f59e0b', amount = 22) {
  for (let i = 0; i < amount; i += 1) {
    const ang = rand(0, Math.PI * 2);
    const spd = rand(40, 220);
    particles.push({
      x,
      y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      life: rand(0.35, 0.8),
      size: rand(1.5, 4.5),
      color
    });
  }
  world.cameraShake = Math.min(12, world.cameraShake + 3.5);
}

function fireBullet(now) {
  if (now - player.lastShot < player.fireRateMs / player.ammoMod) return;
  const angle = Math.atan2(world.mouse.y - player.y, world.mouse.x - player.x);
  player.facing = angle;
  player.lastShot = now;
  bullets.push({
    x: player.x + Math.cos(angle) * 18,
    y: player.y + Math.sin(angle) * 18,
    vx: Math.cos(angle) * player.bulletSpeed,
    vy: Math.sin(angle) * player.bulletSpeed,
    r: 4,
    dmg: player.bulletDamage,
    life: 1.1
  });
}

function distSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function handleInput(dt) {
  let dx = 0;
  let dy = 0;
  if (world.keys.KeyW || world.keys.ArrowUp) dy -= 1;
  if (world.keys.KeyS || world.keys.ArrowDown) dy += 1;
  if (world.keys.KeyA || world.keys.ArrowLeft) dx -= 1;
  if (world.keys.KeyD || world.keys.ArrowRight) dx += 1;

  const len = Math.hypot(dx, dy) || 1;
  player.x += (dx / len) * player.speed * dt;
  player.y += (dy / len) * player.speed * dt;

  player.x = clamp(player.x, player.radius, canvas.width - player.radius);
  player.y = clamp(player.y, player.radius, canvas.height - player.radius);

  if (player.dashCd > 0) player.dashCd -= dt;
}

function updateGame(dt, now) {
  handleInput(dt);
  world.waveTimer += dt;

  if (world.waveTimer > 12) {
    world.waveTimer = 0;
    world.level += 1;
    spawnWave(world.level);
  }

  for (let i = bullets.length - 1; i >= 0; i -= 1) {
    const b = bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0 || b.x < -20 || b.x > canvas.width + 20 || b.y < -20 || b.y > canvas.height + 20) {
      bullets.splice(i, 1);
    }
  }

  for (let i = enemies.length - 1; i >= 0; i -= 1) {
    const e = enemies[i];
    const ang = Math.atan2(player.y - e.y, player.x - e.x);
    e.vx = Math.cos(ang) * e.speed;
    e.vy = Math.sin(ang) * e.speed;
    e.x += e.vx * dt;
    e.y += e.vy * dt;

    if (distSq(e.x, e.y, player.x, player.y) < (e.r + player.radius) ** 2) {
      world.health -= e.type === 'tank' ? 20 * dt : 12 * dt;
      addExplosion(player.x, player.y, '#ef4444', 3);
    }

    for (let j = bullets.length - 1; j >= 0; j -= 1) {
      const b = bullets[j];
      if (distSq(e.x, e.y, b.x, b.y) < (e.r + b.r) ** 2) {
        e.hp -= b.dmg;
        bullets.splice(j, 1);
        addExplosion(b.x, b.y, '#fbbf24', 6);
        if (e.hp <= 0) {
          addExplosion(e.x, e.y, '#fb7185', 18);
          world.score += e.type === 'tank' ? 60 : 20;
          if (Math.random() < 0.2) spawnPickup();
          enemies.splice(i, 1);
          break;
        }
      }
    }
  }

  for (let i = pickups.length - 1; i >= 0; i -= 1) {
    const p = pickups[i];
    p.ttl -= dt * 1000;
    if (p.ttl <= 0) {
      pickups.splice(i, 1);
      continue;
    }
    if (distSq(p.x, p.y, player.x, player.y) < (p.r + player.radius) ** 2) {
      if (p.kind === 'heal') {
        world.health = Math.min(100, world.health + 22);
      } else {
        player.ammoMod = Math.min(2.3, player.ammoMod + 0.25);
        setTimeout(() => {
          player.ammoMod = Math.max(1, player.ammoMod - 0.2);
        }, 4500);
      }
      addExplosion(p.x, p.y, '#22c55e', 14);
      pickups.splice(i, 1);
    }
  }

  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.96;
    p.vy *= 0.96;
    if (p.life <= 0) particles.splice(i, 1);
  }

  if (world.health <= 0) {
    world.running = false;
  }

  updateHud();
}

function drawBackground(now) {
  const t = now * 0.0002;
  ctx.fillStyle = '#060a14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(59,130,246,0.14)';
  ctx.lineWidth = 1;
  const grid = 36;
  for (let x = 0; x < canvas.width; x += grid) {
    ctx.beginPath();
    ctx.moveTo(x + (t * 40) % grid, 0);
    ctx.lineTo(x + (t * 40) % grid, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += grid) {
    ctx.beginPath();
    ctx.moveTo(0, y + (t * 20) % grid);
    ctx.lineTo(canvas.width, y + (t * 20) % grid);
    ctx.stroke();
  }
}

function drawPlayer() {
  const angle = Math.atan2(world.mouse.y - player.y, world.mouse.x - player.x);
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(angle);
  ctx.fillStyle = '#22d3ee';
  ctx.beginPath();
  ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(6, -4, 18, 8);
  ctx.restore();
}

function drawAll(now) {
  if (world.cameraShake > 0.2) {
    const shakeX = rand(-world.cameraShake, world.cameraShake);
    const shakeY = rand(-world.cameraShake, world.cameraShake);
    ctx.setTransform(1, 0, 0, 1, shakeX, shakeY);
    world.cameraShake *= 0.84;
  } else {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    world.cameraShake = 0;
  }

  drawBackground(now);

  for (const p of pickups) {
    ctx.beginPath();
    ctx.fillStyle = p.kind === 'heal' ? '#22c55e' : '#60a5fa';
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const b of bullets) {
    ctx.beginPath();
    ctx.fillStyle = '#fbbf24';
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const e of enemies) {
    ctx.beginPath();
    ctx.fillStyle = e.color;
    ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const p of particles) {
    ctx.beginPath();
    ctx.globalAlpha = clamp(p.life * 2, 0, 1);
    ctx.fillStyle = p.color;
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawPlayer();

  if (!world.running) {
    ctx.fillStyle = 'rgba(0,0,0,0.56)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.font = '700 42px Inter, sans-serif';
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 16);
    ctx.font = '500 20px Inter, sans-serif';
    ctx.fillText(`Score: ${world.score}`, canvas.width / 2, canvas.height / 2 + 22);
    ctx.font = '500 16px Inter, sans-serif';
    ctx.fillText('Press Start Game to respawn', canvas.width / 2, canvas.height / 2 + 56);
  }
}

function gameLoop(time) {
  const now = time || 0;
  const dt = Math.min(0.033, (now - world.lastTime) / 1000 || 0);
  world.lastTime = now;

  if (world.running) {
    updateGame(dt, now);
  }
  drawAll(now);
  requestAnimationFrame(gameLoop);
}

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  world.mouse.x = ((e.clientX - rect.left) / rect.width) * canvas.width;
  world.mouse.y = ((e.clientY - rect.top) / rect.height) * canvas.height;
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0 && world.running) {
    fireBullet(performance.now());
  }
});

window.addEventListener('keydown', (e) => {
  world.keys[e.code] = true;
  if (e.code === 'Space' && world.running && player.dashCd <= 0) {
    const ang = Math.atan2(world.mouse.y - player.y, world.mouse.x - player.x);
    player.x += Math.cos(ang) * 72;
    player.y += Math.sin(ang) * 72;
    player.dashCd = 2.1;
    addExplosion(player.x, player.y, '#38bdf8', 12);
  }
});

window.addEventListener('keyup', (e) => {
  world.keys[e.code] = false;
});

startBtn.addEventListener('click', () => {
  resetGame();
});

addFireBtn.addEventListener('click', () => {
  spawnEnemy(Math.random() < 0.35 ? 'tank' : 'grunt');
});

addRainBtn.addEventListener('click', () => {
  spawnPickup();
});

updateHud();
drawAll(0);
requestAnimationFrame(gameLoop);
