export default {
  title: 'Cloudburst Crossing 3D',
  engine: 'three',
  seed: 517203,
  width: 1600,
  height: 1100,
  animated: true,
  captureFrames: 30,
  versionNote: 'Three rebuild: scanned street furniture, planar wet-road reflection, ink figures',
  description:
    'The p5 crossing rebuilt as a real scene — metres, a camera, and light that has to travel. The street furniture is CC0 photogrammetry from Poly Haven, graded down out of daylight into a sodium-lit night. The road is a shader: a puddle field carved by the camber so water pools in the gutters, a mirrored half-resolution pass sampled through the water\'s own normal, and one GGX highlight per emitter, which is what stretches a lamp into the long broken streak a wet street actually gives you. Rain falls as three depth-graded shells lit by those same emitters rather than hatched uniformly over the frame, and it lands as interfering ring ripples and a ground-hugging spray that is only visible inside a light pool. The people are drawn rather than modelled: procedural ink-and-wash caricatures, one walk-cycle atlas each, crossing the view in profile so the drawing is seen from the angle it was drawn at.'
};
