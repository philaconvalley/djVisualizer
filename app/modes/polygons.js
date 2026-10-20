/* Polygon Collage — the set accumulating into one image.
 *
 * Paint lands and stays, so by the end of a track the screen is a record of
 * what was played. It draws into its own 2D buffer: accumulating in the
 * WEBGL framebuffer meant paint survived a mode switch and reappeared under
 * the next mode. The buffer also fades, very slowly — without it a long set
 * turns the screen to mud, which is the failure mode of every collage.
 *
 * `clearsBackground: false` is what asks for that buffer. The visualizer
 * then keeps the WEBGL canvas transparent, shows its 2D layer underneath, and
 * hands the layer to this mode as `stage.layer`. The layer is cleared on a
 * mode switch, a resize, and a stop, so stale paint never survives any of them.
 *
 * Colour is strictly the three band tokens and blends between them. The
 * previous version reached for pure red, green, blue, yellow, cyan, magenta
 * and white, which broke the palette contract on the one mode the demo ends
 * on. */

export default {
  id: 'polygons',
  label: 'Polygon Collage',
  clearsBackground: false,

  // Frames since the last shape, for the musical sampling rate below.
  setup: () => ({ frames: 0 }),

  draw(_p, stage, memory) {
    const { canvas, ctx } = stage.layer;
    const width = canvas.width;
    // Paint stays clear of the rail like every other mode's composition does.
    const height = canvas.height - stage.railH;

    const bass = stage.band('bass'),
      mid = stage.band('mid'),
      high = stage.band('high');
    if (bass + mid + high <= 0.06) return;

    // Sample at a musical rate rather than a frame count, so a faster track
    // fills the canvas faster.
    memory.frames++;
    const interval = Math.max(2, Math.round(8 * (stage.beatPeriod / 0.5)));
    if (memory.frames < interval) return;
    memory.frames = 0;

    // Very slow fade. Enough to keep a two-hour set legible, slight enough that
    // within a track it still reads as pure accumulation — the mode's identity.
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.018)';
    ctx.fillRect(0, 0, width, canvas.height);
    ctx.restore();

    const zones = [
      { name: 'bass', lit: bass, y: height * 0.74, spread: height * 0.18 },
      { name: 'mid', lit: mid, y: height * 0.5, spread: height * 0.15 },
      { name: 'high', lit: high, y: height * 0.26, spread: height * 0.17 }
    ];

    const spin = stage.phase * Math.PI * 2;
    for (const zone of zones) {
      if (zone.lit < 0.05) continue;
      paintShape(
        ctx,
        stage.colors,
        {
          name: zone.name,
          lit: zone.lit,
          points: 3 + Math.round(zone.lit * 3),
          cx: width * 0.5 + Math.cos(spin * 1.3 + zone.y * 0.01) * width * 0.26,
          cy: zone.y + Math.sin(spin * 2) * zone.spread,
          radius: zone.lit * Math.min(width, height) * 0.28 * (1 + stage.beat * 0.4),
          rotation: spin + Math.random() * 0.7
        },
        { bass, mid, high }
      );
    }
  }
};

function paintShape(ctx, colors, shape, levels) {
  // Blend between the band tokens by how much of each band is present. A
  // bass-and-mid moment lands between red and green rather than jumping to a
  // fourth colour the palette never agreed to. The previous version reached
  // for pure yellow, cyan, magenta and white here, on the one mode the
  // meetup demo ends on.
  const total = levels.bass + levels.mid + levels.high || 1;
  const own = colors[shape.name];
  const mixed = [0, 1, 2].map(
    (channel) =>
      (colors.bass[channel] * levels.bass +
        colors.mid[channel] * levels.mid +
        colors.high[channel] * levels.high) /
      total
  );
  // Two thirds its own band, one third the room. Keeps a shape identifiable
  // as bass or high while still recording what else was playing under it.
  const rgb = mixed.map((v, i) => Math.round(own[i] * 0.66 + v * 0.34));
  const alpha = (0.16 + shape.lit * 0.45).toFixed(3);

  ctx.save();
  ctx.translate(shape.cx, shape.cy);
  ctx.rotate(shape.rotation);
  ctx.fillStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  ctx.beginPath();
  for (let i = 0; i < shape.points; i++) {
    const angle = (i / shape.points) * Math.PI * 2;
    const r = shape.radius * (0.6 + (i % 2) * 0.4);
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
