import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let starField, dustParticles, galleryWall, artwork, ambientLight;
let lights = { left: null, center: null, right: null };
let moveState = { forward: false, backward: false, left: false, right: false, up: false, down: false };
let isDynamic = true;
let isAutopilot = false;
let autopilotTime = 0;
let autopilotContentTimer = 0;

const moveSpeed = 0.25;
const PLAYER_HEIGHT = 1.6;

let currentType = 'jpg';
let currentIndex = 1;

// NOAA DATA
let noaaData = {
    ssn: 50,
    kp: 2,
    bz: 0,
    solarWind: 400,
    protonFlux: 1,
    electronFlux: 100,
    stormLevel: 0,
    radiationLevel: 0,
    recentFlare: 'None'
};

init();
animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.012);

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, PLAYER_HEIGHT, 15);

    renderer = new THREE.WebGLRenderer({ antialias: true, stencil: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    ambientLight = new THREE.AmbientLight(0xffffff, 0.03);
    scene.add(ambientLight);

    const targetPos = new THREE.Vector3(0, PLAYER_HEIGHT + 0.5, -2);

    createLights(targetPos);
    createStars();
    createSpaceDust();
    createFloor();
    createVolumetricDisplay(targetPos);
    createCurtains();

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Full 3D Navigation - No restrictions
    controls.minPolarAngle = 0; // Can look straight up
    controls.maxPolarAngle = Math.PI; // Can look straight down

    // Macro Zoom - Get extremely close to artwork
    controls.minDistance = 0.1; // Macro view (10cm from surface)
    controls.maxDistance = 50; // Wide overview

    // Enable vertical panning
    controls.enablePan = true;
    controls.panSpeed = 0.8;
    controls.screenSpacePanning = true; // Pan in screen space (easier control)

    // Center focus on artwork
    controls.target.set(0, PLAYER_HEIGHT + 0.5, -2);

    window.addEventListener('resize', onWindowResize, false);

    // UI Exposure
    window.updateLights = updateLights;
    window.moveCamera = moveCamera;
    window.stopCamera = stopCamera;
    window.resetPosition = resetPosition;
    window.nextContent = nextContent;
    window.prevContent = prevContent;
    window.randomContent = randomContent;
    window.toggleFX = toggleFX;
    window.toggleAutopilot = toggleAutopilot;

    updateUI();
    loadContent();
    setupJoystick();
    updateSpaceWeather();
    setInterval(updateSpaceWeather, 60000); // Update every minute
    setTimeout(hideLoading, 600);
}

async function updateSpaceWeather() {
    try {
        const [rSSN, rProton, rFlare, rKp, rWind, rElectron] = await Promise.all([
            fetch('https://services.swpc.noaa.gov/json/solar-cycle/predicted-solar-cycle.json').then(r => r.json()).catch(() => null),
            fetch('https://services.swpc.noaa.gov/json/goes/primary/integral-protons-plot-6-hour.json').then(r => r.json()).catch(() => null),
            fetch('https://services.swpc.noaa.gov/json/goes/primary/xray-flares-7-day.json').then(r => r.json()).catch(() => null),
            fetch('https://services.swpc.noaa.gov/json/planetary_k_index_1m.json').then(r => r.json()).catch(() => null),
            fetch('https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json').then(r => r.json()).catch(() => null),
            fetch('https://services.swpc.noaa.gov/json/goes/primary/integral-electrons-plot-6-hour.json').then(r => r.json()).catch(() => null)
        ]);

        if (rSSN) noaaData.ssn = rSSN[rSSN.length - 1]?.predicted_ssn || 50;
        if (rProton) noaaData.protonFlux = parseFloat(rProton[rProton.length - 1]?.flux) || 1;
        if (rKp) noaaData.kp = parseFloat(rKp[rKp.length - 1]?.kp_index) || 2;
        if (rWind?.length) {
            noaaData.solarWind = parseFloat(rWind[rWind.length - 1].wind_speed) || 400;
            noaaData.bz = parseFloat(rWind[rWind.length - 1].bz) || 0;
        }
        if (rElectron) noaaData.electronFlux = parseFloat(rElectron[rElectron.length - 1]?.flux) || 100;
        if (rFlare?.length) {
            const latest = rFlare[rFlare.length - 1];
            noaaData.recentFlare = latest.current_class || latest.max_class || 'None';
        }

        let flareBoost = noaaData.recentFlare.startsWith('X') ? 0.8 : noaaData.recentFlare.startsWith('M') ? 0.3 : 0;
        noaaData.radiationLevel = Math.min(1, (Math.log10(noaaData.protonFlux + 1) / 5) + flareBoost);
        noaaData.stormLevel = Math.min(1, (noaaData.kp / 9) + (noaaData.bz < 0 ? Math.abs(noaaData.bz) / 20 : 0));

        // Update UI
        document.getElementById('noaa-ssn').textContent = noaaData.ssn.toFixed(1);
        document.getElementById('noaa-kp').textContent = noaaData.kp.toFixed(1);
        document.getElementById('noaa-bz').textContent = noaaData.bz.toFixed(1);
        document.getElementById('noaa-wind').textContent = noaaData.solarWind.toFixed(0);
        document.getElementById('noaa-proton').textContent = noaaData.protonFlux.toFixed(2);
        document.getElementById('noaa-flare').textContent = noaaData.recentFlare;

        console.log('🌌 NOAA Data Updated:', noaaData);
        updateLightsFromNOAA();
    } catch (e) {
        console.warn("NOAA Sync Failed, using defaults");
    }
}

function updateLightsFromNOAA() {
    // Base intensity from SSN (more sunspots = brighter gallery)
    const baseIntensity = 300 + (noaaData.ssn * 8);

    // Storm modulation (Kp affects pulsation amplitude)
    const stormMod = 1 + (noaaData.stormLevel * 0.5);

    // Update base intensities
    if (lights.left) lights.left.userData.baseIntensity = baseIntensity * stormMod;
    if (lights.center) lights.center.userData.baseIntensity = baseIntensity * stormMod * 1.2;
    if (lights.right) lights.right.userData.baseIntensity = baseIntensity * stormMod;

    // Bz affects color spectrum
    const bzShift = noaaData.bz * 15; // Negative Bz = redder, positive = bluer

    // Update UI color pickers to reflect NOAA influence
    const leftInput = document.getElementById('color-left');
    const rightInput = document.getElementById('color-right');

    if (leftInput && rightInput) {
        // Left light shifts with Bz (more red during southward Bz)
        const leftHue = Math.max(0, Math.min(360, 350 - bzShift));
        const rightHue = Math.max(0, Math.min(360, 220 + bzShift));

        leftInput.value = hslToHex(leftHue, 100, 50);
        rightInput.value = hslToHex(rightHue, 100, 50);

        updateLights();
    }
}

function hslToHex(h, s, l) {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

function createLights(target) {
    const shadowTarget = new THREE.Object3D();
    shadowTarget.position.copy(target);
    scene.add(shadowTarget);

    // THEATRICAL SETUP: Dramatic angles from above and sides
    const setupLight = (name, xPos, yPos, zPos, color) => {
        const light = new THREE.SpotLight(color, 800);
        light.position.set(xPos, yPos, zPos);
        light.target = shadowTarget;
        light.angle = 0.45; // Tighter beam for drama
        light.penumbra = 0.7; // Softer edges
        light.decay = 1.2; // Slower falloff
        light.distance = 60;
        light.castShadow = true;
        light.shadow.mapSize.width = 2048;
        light.shadow.mapSize.height = 2048;
        scene.add(light);
        lights[name] = light;
        light.userData.baseIntensity = 800;
    };

    // Left: High angle from upper left (key light)
    setupLight('left', -9, 10, 6, 0xff3366);
    // Center: Directly above (fill light)
    setupLight('center', 0, 12, 4, 0xffffff);
    // Right: High angle from upper right (rim light)
    setupLight('right', 9, 10, 6, 0x3366ff);
}

function createSpaceDust() {
    const geo = new THREE.BufferGeometry();
    const count = 3000;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 30;
        pos[i * 3 + 1] = (Math.random()) * 10;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 20;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0.3 });
    dustParticles = new THREE.Points(geo, mat);
    scene.add(dustParticles);
}

function toggleAutopilot() {
    isAutopilot = !isAutopilot;
    const btn = document.getElementById('autopilot-btn');
    btn.innerText = `AUTOPILOT: ${isAutopilot ? 'ON' : 'OFF'}`;
    btn.style.color = isAutopilot ? '#00ff88' : 'white';
    if (isAutopilot) {
        autopilotTime = 0;
        autopilotContentTimer = 0;
    }
}

function toggleFX() {
    isDynamic = !isDynamic;
    const btn = document.getElementById('fx-dynamic');
    btn.innerText = `DYNAMIC: ${isDynamic ? 'ON' : 'OFF'}`;
    btn.style.color = isDynamic ? '#00ff88' : '#ff4444';
}

function updateLights() {
    ['left', 'center', 'right'].forEach(pos => {
        const input = document.getElementById(`color-${pos}`);
        if (input && lights[pos]) {
            lights[pos].color.set(input.value);
            input.parentElement.querySelector('.c-icon').style.background = input.value;
        }
    });
}

function loadContent() {
    const filename = `${currentIndex}.${currentType}`;
    new THREE.TextureLoader().load(filename,
        (t) => { artwork.material.map = t; artwork.material.color.set(0xffffff); artwork.material.needsUpdate = true; },
        undefined,
        () => generatePlaceholder(filename)
    );
}

function generatePlaceholder(name) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#050505'; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 15; ctx.strokeRect(40, 40, 432, 432);
    ctx.fillStyle = '#444'; ctx.font = 'bold 36px Arial'; ctx.textAlign = 'center';
    ctx.fillText(name.toUpperCase(), 256, 256);
    artwork.material.map = new THREE.CanvasTexture(canvas); artwork.material.needsUpdate = true;
}

function nextContent() { currentIndex++; if (currentIndex > 13) { currentIndex = 1; currentType = currentType == 'jpg' ? 'gif' : 'jpg'; } updateUI(); loadContent(); }
function prevContent() { currentIndex--; if (currentIndex < 1) { currentIndex = 13; currentType = currentType == 'jpg' ? 'gif' : 'jpg'; } updateUI(); loadContent(); }
function randomContent() { currentIndex = Math.floor(Math.random() * 13) + 1; currentType = Math.random() > 0.5 ? 'jpg' : 'gif'; updateUI(); loadContent(); }
function updateUI() { document.getElementById('current-type').innerText = currentType.toUpperCase(); document.getElementById('current-index').innerText = `${currentIndex}/13`; }

function createStars() {
    const starGeo = new THREE.BufferGeometry();
    const count = 20000;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 1500;
        pos[i * 3 + 1] = (Math.random() - 0.5) * 1500;
        pos[i * 3 + 2] = (Math.random() - 0.5) * 1500;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starField = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.8, transparent: true, opacity: 0.4 }));
    scene.add(starField);
}

function createFloor() {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x010101, roughness: 0.05, metalness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
}

function createVolumetricDisplay(pos) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(18, 14, 1), new THREE.MeshStandardMaterial({ color: 0x050505 }));
    wall.position.set(pos.x, pos.y + 1, pos.z - 0.8); scene.add(wall);

    // REACTIVE FRAME - Changes with NOAA data
    const frameGeo = new THREE.BoxGeometry(7, 5, 0.5);
    const frameMat = new THREE.MeshStandardMaterial({
        color: 0x020202,
        emissive: 0x000000,
        emissiveIntensity: 0,
        roughness: 0.3,
        metalness: 0.8
    });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(pos.x, pos.y + 0.5, pos.z + 0.1);
    scene.add(frame);
    frame.userData.baseY = pos.y + 0.5;
    frame.userData.material = frameMat;

    // Store frame reference globally
    window.reactiveFrame = frame;

    artwork = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveIntensity: 0.02 }));
    artwork.position.set(pos.x, pos.y + 0.5, pos.z + 0.36); artwork.castShadow = true; scene.add(artwork);
}

function createCurtains() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x040202, side: THREE.DoubleSide });
    const left = new THREE.Mesh(new THREE.PlaneGeometry(12, 25), mat);
    left.position.set(-13, 8, 5); left.rotation.y = Math.PI / 3; scene.add(left);
    const right = new THREE.Mesh(new THREE.PlaneGeometry(12, 25), mat);
    right.position.set(13, 8, 5); right.rotation.y = -Math.PI / 3; scene.add(right);
}

function moveCamera(dir) { moveState[dir] = true; }
function stopCamera() { Object.keys(moveState).forEach(k => moveState[k] = false); }
function resetPosition() {
    camera.position.set(0, PLAYER_HEIGHT + 0.5, 8);
    controls.target.set(0, PLAYER_HEIGHT + 0.5, -2);
}

function setupJoystick() {
    const thumb = document.getElementById('joystick-thumb');
    let active = false, startX, startY;
    if (!thumb) return;
    thumb.addEventListener('mousedown', (e) => { active = true; startX = e.clientX; startY = e.clientY; });
    window.addEventListener('mousemove', (e) => {
        if (!active) return;
        const dx = e.clientX - startX, dy = e.clientY - startY;
        const dist = Math.min(Math.sqrt(dx * dx + dy * dy), 12);
        const angle = Math.atan2(dy, dx);
        thumb.style.transform = `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px)`;
        moveState.forward = dy < -5; moveState.backward = dy > 5; moveState.left = dx < -5; moveState.right = dx > 5;
    });
    window.addEventListener('mouseup', () => { active = false; thumb.style.transform = `translate(0px, 0px)`; stopCamera(); });
}

function onWindowResize() { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); }
function hideLoading() { const ls = document.getElementById('loading-screen'); if (ls) { ls.style.opacity = '0'; setTimeout(() => ls.style.display = 'none', 600); } }

function animate() {
    requestAnimationFrame(animate);
    const time = Date.now() * 0.001;

    // AUTOPILOT MODE - Cinematic flight
    if (isAutopilot) {
        autopilotTime += 0.01;
        autopilotContentTimer += 0.016; // ~60fps

        // Auto-switch content every 8 seconds
        if (autopilotContentTimer >= 8) {
            randomContent();
            autopilotContentTimer = 0;
        }

        // Orbital path with varying radius and height
        const radius = 8 + Math.sin(autopilotTime * 0.3) * 3;
        const height = PLAYER_HEIGHT + Math.sin(autopilotTime * 0.5) * 2;
        const angle = autopilotTime * 0.15;

        // Smooth orbital position
        camera.position.x = Math.cos(angle) * radius;
        camera.position.z = Math.sin(angle) * radius + 2;
        camera.position.y = height;

        // Dynamic target with slight drift
        const targetX = Math.sin(autopilotTime * 0.2) * 0.5;
        const targetY = PLAYER_HEIGHT + 0.5 + Math.cos(autopilotTime * 0.3) * 0.3;
        const targetZ = -2 + Math.sin(autopilotTime * 0.25) * 0.2;

        controls.target.set(targetX, targetY, targetZ);
    } else {
        // Manual camera movement - straight direction without orbit
        const moveVector = new THREE.Vector3();

        if (moveState.forward || moveState.backward || moveState.left || moveState.right || moveState.up || moveState.down) {
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);
            dir.y = 0; // Keep horizontal for forward/back/left/right
            dir.normalize();

            const side = new THREE.Vector3().crossVectors(camera.up, dir).normalize();

            if (moveState.forward) moveVector.addScaledVector(dir, moveSpeed);
            if (moveState.backward) moveVector.addScaledVector(dir, -moveSpeed);
            if (moveState.left) moveVector.addScaledVector(side, moveSpeed);
            if (moveState.right) moveVector.addScaledVector(side, -moveSpeed);

            // Vertical movement - pure up/down without changing view angle
            if (moveState.up) moveVector.y += moveSpeed;
            if (moveState.down) moveVector.y -= moveSpeed;

            camera.position.add(moveVector);
            controls.target.add(moveVector); // Move target with camera to maintain view direction
        }
    }

    // NOAA-DRIVEN DYNAMICS
    if (isDynamic) {
        // REACTION 1: Light Breathing (Kp-driven pulsation)
        const breathSpeed = 1.5 + (noaaData.kp / 3);
        const breathDepth = 0.2 + (noaaData.stormLevel * 0.3);

        ['left', 'center', 'right'].forEach((l, i) => {
            if (lights[l]) {
                const pulse = Math.sin(time * breathSpeed + i * 2) * breathDepth + (1 - breathDepth / 2);
                lights[l].intensity = lights[l].userData.baseIntensity * pulse;

                if (noaaData.recentFlare.startsWith('X')) {
                    const flarePulse = Math.sin(time * 8) * 0.5 + 1.5;
                    lights[l].intensity *= flarePulse;
                } else if (noaaData.recentFlare.startsWith('M')) {
                    const flarePulse = Math.sin(time * 5) * 0.3 + 1.2;
                    lights[l].intensity *= flarePulse;
                }
            }
        });

        // REACTION 2: REACTIVE FRAME ANIMATIONS
        if (window.reactiveFrame) {
            const frame = window.reactiveFrame;
            const mat = frame.userData.material;

            // Color Mode based on Bz (magnetic field direction)
            if (noaaData.bz < -5) {
                // Strong southward = Red/Orange glow (geomagnetic storm warning)
                mat.emissive.setHex(0xff3300);
                mat.emissiveIntensity = 0.3 + Math.sin(time * 2) * 0.2;
            } else if (noaaData.bz > 5) {
                // Strong northward = Blue/Cyan calm
                mat.emissive.setHex(0x0066ff);
                mat.emissiveIntensity = 0.15 + Math.sin(time * 1) * 0.1;
            } else if (noaaData.kp > 5) {
                // High Kp = Purple storm mode
                mat.emissive.setHex(0x9933ff);
                mat.emissiveIntensity = 0.4 + Math.sin(time * 3) * 0.3;
            } else if (noaaData.ssn > 100) {
                // High solar activity = Golden glow
                mat.emissive.setHex(0xffaa00);
                mat.emissiveIntensity = 0.2 + Math.sin(time * 1.5) * 0.15;
            } else {
                // Calm state = subtle cyan
                mat.emissive.setHex(0x003344);
                mat.emissiveIntensity = 0.05 + Math.sin(time * 0.5) * 0.05;
            }

            // Vibration from radiation
            if (noaaData.radiationLevel > 0.3) {
                const vibration = Math.sin(time * 20) * noaaData.radiationLevel * 0.02;
                frame.rotation.z = vibration;
            } else {
                frame.rotation.z = 0;
            }

            // Slow drift from solar wind
            const drift = (noaaData.solarWind - 400) / 10000;
            frame.position.y = frame.userData.baseY + Math.sin(time * 0.3) * drift * 0.5;
        }

        // REACTION 3: Floating Space Dust
        if (dustParticles) {
            const driftSpeed = (noaaData.solarWind - 400) / 1000;
            dustParticles.position.y = Math.sin(time * 0.5) * 0.2;
            dustParticles.rotation.y += 0.001 + driftSpeed;
            dustParticles.material.opacity = 0.2 + (noaaData.stormLevel * 0.3);
        }

        // REACTION 4: Star Flow
        const starSpeed = 0.0003 + (noaaData.ssn / 50000);
        starField.rotation.y += starSpeed;
        starField.position.z += Math.sin(time) * 0.15;

        // REACTION 5: Radiation Interference
        if (noaaData.radiationLevel > 0.3) {
            starField.material.opacity = 0.4 + Math.sin(time * 10) * noaaData.radiationLevel * 0.2;
        } else {
            starField.material.opacity = 0.4;
        }

        // REACTION 6: Ambient Light Storm Response
        ambientLight.intensity = 0.03 + (noaaData.stormLevel * 0.05);

    } else {
        starField.rotation.y += 0.0002;
    }

    controls.update();
    renderer.render(scene, camera);
}
