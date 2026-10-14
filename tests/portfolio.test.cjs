const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Run the actual page script with a clock we control. WebGL/DOM are replaced only
// at the boundary; pointer handlers, animation, and layout calculations are real.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\}\)\(\);\s*$/, `
  globalThis.page = {
    read: () => ({ q: [...q], glide, vel: [...vel], R, centerX, centerY,
      layoutTarget, dragging, pointerId, nodes: NODES.map(n => ({id:n.id, pos:n.pos})) }),
    landFromRelease, labelEnvelope, resize, openNode, closePanel
  };
})();`);

function createPage(width = 1280, height = 720, { reduced = false, insets = {} } = {}) {
  let now = 10000, nextFrame;
  const events = new Map(), elements = new Map();
  const root = { dataset: {} };
  const gl = new Proxy({}, { get: (_, key) => key === 'getShaderParameter' ? () => true : () => {} });
  const ctx = {
    font: '', createImageData: () => ({ data: new Uint8ClampedArray(180 * 180 * 4) }),
    putImageData() {}, measureText(text) { return { width: text.length * parseFloat(this.font.split(' ')[1]) * 0.65 }; }
  };
  function element(id) {
    const listeners = new Map(), classes = new Set();
    let captured = null;
    return {
      id, style: { setProperty() {} }, children: [],
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), toggle() {} },
      addEventListener(name, fn) { listeners.set(name, fn); },
      dispatch(name, e) { listeners.get(name)?.(e); },
      appendChild(child) { this.children.push(child); }, setAttribute() {},
      setPointerCapture(id) { captured = id; }, hasPointerCapture: id => captured === id,
      releasePointerCapture() { captured = null; },
      getContext: type => type === 'webgl' ? gl : ctx, toDataURL: () => 'data:image/png;base64,',
      get clientWidth() { return width; }, get clientHeight() { return height; },
      getBoundingClientRect() { return { width: id === 'panel' ? this.offsetWidth : width, height: id === 'panel' ? this.offsetHeight : height }; },
      get offsetWidth() { return root.dataset.panelLayout === 'bottom' ? width : Math.min(440, width * 0.44); },
      get offsetHeight() { return root.dataset.panelLayout === 'bottom' ? height * 0.62 : height; }
    };
  }
  const sandbox = {
    console, document: { documentElement: root, fonts: { ready: Promise.resolve() },
      getElementById(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); },
      createElement: tag => element(tag)
    },
    performance: { now: () => now }, devicePixelRatio: 2,
    getComputedStyle: () => ({ fontFamily: 'sans-serif', paddingLeft: insets.left || 0,
      paddingTop: insets.top || 0, paddingRight: insets.right || 0, paddingBottom: insets.bottom || 0 }),
    matchMedia: () => ({ matches: reduced }), ResizeObserver: class { observe() {} },
    visualViewport: { addEventListener() {} },
    addEventListener(name, fn) { events.set(name, fn); },
    requestAnimationFrame(fn) { nextFrame = fn; }, setTimeout() {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return {
    api: sandbox.page, root,
    tick(time) { now = time; nextFrame(now); },
    event(type, x, y, time, pointerId = 1, delay = 0) {
      now = time + delay;
      const event = { type, clientX: x, clientY: y, timeStamp: time, pointerId, button: 0, isPrimary: true };
      if (type === 'pointerdown') elements.get('stage').dispatch(type, event);
      else events.get(type)?.(event);
    },
    resize(w, h) { width = w; height = h; sandbox.page.resize(); },
    time: () => now
  };
}

function multiply(a, b) {
  const [w,x,y,z] = a, [v,i,j,k] = b;
  return [w*v-x*i-y*j-z*k, w*i+x*v+y*k-z*j, w*j-x*k+y*v+z*i, w*k+x*j-y*i+z*v];
}
function angularVelocity(a, b, dt) {
  let delta = multiply(b, [a[0], -a[1], -a[2], -a[3]]);
  if (delta[0] < 0) delta = delta.map(x => -x);
  const length = Math.hypot(...delta.slice(1));
  const scale = length ? 2 * Math.atan2(length, delta[0]) / length / dt : 0;
  return delta.slice(1).map(x => x * scale);
}
function assertCentered(state) {
  const closest = Math.max(...state.nodes.map(n => {
    const rotated = multiply(multiply(state.q, [0, ...n.pos]), [state.q[0], -state.q[1], -state.q[2], -state.q[3]]);
    return rotated[3];
  }));
  assert.ok(closest > 1 - 1e-9, `title should land at the front, got z=${closest}`);
}

test('release velocity continues immediately, and each landing eases to a centered rest', () => {
  for (const w of [[0,0.00005,0], [0.0003,0.0008,0], [0.004,-0.006,0], [-0.02,0.03,0], [0,0.1,0]]) {
    const p = createPage(), start = p.api.read().q;
    p.api.landFromRelease(w);
    const glide = p.api.read().glide, t0 = p.time(), epsilon = 0.01;
    p.tick(t0 + epsilon);
    const velocity = angularVelocity(start, p.api.read().q, epsilon);
    assert.ok(Math.hypot(...velocity.map((v,i) => v - w[i])) < Math.hypot(...w) * 0.001,
      `release tangent changed for ${w}: ${velocity}`);
    let previous = start;
    for (let i = 1; i < 120; i++) {
      p.tick(t0 + glide.T * i / 120);
      const q = p.api.read().q;
      const v = angularVelocity(previous, q, glide.T / 120);
      assert.ok(v.reduce((s,x,j) => s + x * glide.axis[j], 0) >= -1e-8, 'spin must keep its release direction');
      previous = q;
    }
    p.tick(t0 + glide.T - 0.1);
    const before = p.api.read().q;
    p.tick(t0 + glide.T);
    assert.ok(Math.hypot(...angularVelocity(before, p.api.read().q, 0.1)) < 1e-7, 'landing must approach zero velocity');
    assertCentered(p.api.read());
    p.tick(t0 + glide.T + 0.01);
    assert.equal(p.api.read().glide, null);
  }
});

test('a pause around 80 ms fades momentum without the old abrupt cutoff', () => {
  const speedAt = pause => {
    const p = createPage();
    p.event('pointerdown', 100, 100, 10000);
    p.event('pointermove', 120, 105, 10016);
    p.event('pointermove', 140, 110, 10032);
    p.event('pointerup', 140, 110, 10032 + pause);
    return p.api.read().glide.v;
  };
  const a = speedAt(79), b = speedAt(81);
  assert.ok(a > 0 && b > 0, 'both releases must coast');
  assert.ok(Math.abs(b / a - Math.exp(-2 / 80)) < 1e-10);
});

test('event delivery lag and input frequency do not change a steady drag release', () => {
  function release(interval, lag) {
    const p = createPage();
    p.event('pointerdown', 100, 100, 10000, 1, lag);
    for (let t = interval; t <= 160; t += interval) p.event('pointermove', 100 + t, 100 + t / 2, 10000 + t, 1, lag);
    p.event('pointerup', 260, 180, 10160, 1, lag);
    return p.api.read().glide.v;
  }
  assert.ok(Math.abs(release(8, 0) - release(16, 24)) < 1e-12);
});

test('animation position is consistent at 30, 60, and 120 Hz', () => {
  const results = [30,60,120].map(hz => {
    const p = createPage();
    p.api.landFromRelease([0.002,0.004,0]);
    const until = p.time() + p.api.read().glide.T * 0.7;
    for (let t = p.time(); t < until; t += 1000 / hz) p.tick(t);
    p.tick(until);
    return p.api.read().q;
  });
  for (const q of results.slice(1)) assert.ok(Math.hypot(...angularVelocity(results[0], q, 1)) < 1e-10);
});

test('a second pointer cannot steal the drag, and a new drag interrupts a glide without jumping', () => {
  const p = createPage();
  p.event('pointerdown',100,100,10000);
  p.event('pointermove',160,120,10032);
  p.event('pointerup',160,120,10033,2);
  assert.equal(p.api.read().dragging,true);
  p.event('pointerup',160,120,10034);
  p.tick(10200);
  const before = p.api.read().q;
  p.event('pointerdown',100,100,10200);
  assert.equal(p.api.read().glide,null);
  assert.ok(Math.hypot(...angularVelocity(before,p.api.read().q,1)) < 1e-10);
});

test('sphere and title envelope fit portrait, landscape, tablet, desktop, and ultrawide viewports', () => {
  const sizes = [[280,653],[320,568],[390,844],[844,390],[768,1024],[1024,768],
    [1280,720],[1440,900],[2560,1440],[3440,1440],[568,320],[720,720],[960,540],[320,320],[640,360]];
  for (const [width,height] of sizes) {
    for (const open of [false,true]) {
      const p = createPage(width,height);
      if (open) p.api.openNode('projects');
      const state = p.api.read(), layout = state.layoutTarget, bounds = p.api.labelEnvelope(layout.radius);
      const right = open && p.root.dataset.panelLayout === 'side' ? width - Math.min(440,width*0.44) - 12 : width;
      const bottom = open && p.root.dataset.panelLayout === 'bottom' ? height * 0.38 - 12 : height;
      assert.ok(layout.radius > 0, 'radius must be positive');
      assert.ok(layout.x - bounds.x >= 0 && layout.x + bounds.x <= right,
        `horizontal clipping at ${width}×${height}, panel=${open}`);
      assert.ok(layout.y - bounds.y >= 0 && layout.y + bounds.y <= bottom,
        `vertical clipping at ${width}×${height}, panel=${open}`);
    }
  }
});

test('notch insets are reserved and rotating a phone changes panel orientation', () => {
  const p = createPage(390,844,{insets:{top:47,bottom:34,left:0,right:0}});
  let state = p.api.read(), bounds = p.api.labelEnvelope(state.layoutTarget.radius);
  assert.ok(state.layoutTarget.y - bounds.y >= 47);
  assert.ok(state.layoutTarget.y + bounds.y <= 844 - 34);
  p.api.openNode('projects');
  assert.equal(p.root.dataset.panelLayout,'bottom');
  p.resize(844,390);
  assert.equal(p.root.dataset.panelLayout,'side');
});

test('reduced motion lands immediately and remains still', () => {
  const p = createPage(390,844,{reduced:true});
  p.api.landFromRelease([0,0.004,0]);
  p.tick(10002);
  assertCentered(p.api.read());
  const end = p.api.read().q;
  p.tick(20000);
  assert.ok(Math.hypot(...angularVelocity(end,p.api.read().q,1)) < 1e-10);
});
