// Adapted from React Bits Pro ASCII Waves (authenticated registry, September 12, 2026).
// Original shader and glyph atlas retained. Direct Three.js renderer replaces Fiber
// because Fiber 9 does not support this application's React 19.3.
// Product license: https://pro.reactbits.dev/license. See THIRD_PARTY_NOTICES.md.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform vec2 uMouse;
  uniform vec2 uResolution;
  uniform sampler2D uFontTexture;
  uniform float uCharCount;
  uniform vec3 uColor;
  uniform bool uInvert;
  uniform float uScale;
  uniform float uSize;
  uniform float uSpeed;
  uniform float uHasMouse;
  uniform float uIntensity;
  uniform float uInteractIntensity;
  uniform float uWaveTension;
  uniform float uWaveTwist;
  uniform sampler2D uVideoTexture;
  uniform bool uHasVideo;

  varying vec2 vUv;

  #define PI 3.14159265359
  #define TAU 6.28318530718

  float flowField(vec2 p, float t) {
    return sin(p.x + sin(p.y + t * 0.1)) * sin(p.y * p.x * 0.1 + t * 0.2);
  }

  vec2 computeField(vec2 p, float t) {
    vec2 ep = vec2(0.05, 0.0);
    vec2 result = vec2(0.0);
    float tension = uWaveTension;
    float twist = uWaveTwist;

    for (int i = 0; i < 20; i++) {
      float t0 = flowField(p, t);
      float t1 = flowField(p + ep.xy, t);
      float t2 = flowField(p + ep.yx, t);
      vec2 gradient = vec2((t1 - t0), (t2 - t0)) / ep.xx;
      vec2 tangent = vec2(-gradient.y, gradient.x);

      p += tangent * tension + gradient * 0.005;
      p.x += sin(t * 0.25) * twist;
      p.y += cos(t * 0.25) * twist;
      result = gradient;
    }

    return result;
  }

  vec3 getDistortion(vec2 coord) {
      vec2 aspect;

      if(uResolution.x > uResolution.y) {
          aspect = vec2(uResolution.x / uResolution.y, 1.0);
      } else {
          aspect = vec2(uResolution.y / uResolution.x, 1.0);
      }

      vec2 uv0 = coord.xy / uResolution.xy * aspect;
      vec2 muv = uMouse.xy / uResolution.xy * aspect;

      float speed = uSpeed;
      float noiseTime = uTime * speed;

      vec2 diff = uv0 - muv;
      float distance = length(diff);

      float radius = 0.5;
      float interaction = smoothstep(radius, 0.0, distance);

      vec2 p = uv0 * uScale;
      float interactStrength = uInteractIntensity * uHasMouse;

      vec2 mouseDistort = normalize(diff) * interaction * interactStrength;
      p += mouseDistort;
      p.x += sin(uTime * 3.0) * interaction * interactStrength * 0.5;
      p.y += cos(uTime * 3.0) * interaction * interactStrength * 0.5;

      vec2 field = computeField(p, noiseTime);

      float val = length(field) * uIntensity;
      val = clamp(val, 0.0, 1.0);

      vec2 totalDisplacement = mouseDistort + field * 0.5 * uIntensity;

      return vec3(val, totalDisplacement);
  }

  void main() {
      float gridSize = uSize;

      vec2 pix = vUv * uResolution;
      vec2 snappedMuv = floor(pix / gridSize) * gridSize;

      vec3 distData = getDistortion(snappedMuv);
      float intensity = distData.x;
      vec2 displacement = distData.yz;

      vec3 col;
      if (uHasVideo) {
        vec2 videoUV = snappedMuv / uResolution;
        vec2 distortedVideoUV = videoUV + (displacement * 0.1);

        col = texture2D(uVideoTexture, distortedVideoUV).rgb;
      } else {
        col = vec3(intensity);
      }

      float gray = 0.3 * col.r + 0.59 * col.g + 0.11 * col.b;

      if (uInvert) {
        gray = 1.0 - gray;
      }

      float charIndex = floor(gray * (uCharCount - 1.0));
      charIndex = clamp(charIndex, 0.0, uCharCount - 1.0);

      vec2 cellUV = fract(pix / gridSize);

      float charWidth = 1.0 / uCharCount;
      vec2 atlasUV = vec2((cellUV.x * charWidth) + (charIndex * charWidth), cellUV.y);

      vec4 fontSample = texture2D(uFontTexture, atlasUV);
      float alpha = fontSample.a;

      vec3 targetColor = uHasVideo ? col : uColor * (gray + 0.1);
      vec3 finalColor = targetColor * alpha;

      gl_FragColor = vec4(finalColor, alpha);
  }
`;

const createFontTexture = (
  chars: string,
  fontSize: number = 64,
): THREE.Texture => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Texture();

  const charCount = chars.length;
  const width = charCount * fontSize;
  const height = fontSize;

  canvas.width = width;
  canvas.height = height;

  ctx.clearRect(0, 0, width, height);

  ctx.font = `bold ${fontSize}px monospace`;
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = 0; i < charCount; i++) {
    const char = chars[i];
    const x = i * fontSize + fontSize / 2;
    const y = fontSize / 2;
    ctx.fillText(char, x, y);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
};


const fallback = Array.from({length:56},(_,y)=>Array.from({length:32},(_,x)=>{
  const value=(Math.sin(x*.24+Math.sin(y*.16)*2)+Math.cos(y*.23-x*.13)+2)/4;
  return ' .:-+*=%@#'[Math.min(9,Math.floor(value*10))];
}).join('')).join('\n');

export default function AsciiWaves() {
  const hostRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const host=hostRef.current;
    if(!host)return;
    let renderer:THREE.WebGLRenderer;
    try {
      const canvas=document.createElement('canvas');
      const context=canvas.getContext('webgl2',{alpha:true,antialias:false,powerPreference:'low-power'});
      if(!context){host.dataset.renderer='fallback';return}
      renderer=new THREE.WebGLRenderer({canvas,context,alpha:true,antialias:false,powerPreference:'low-power'});
    } catch {
      host.dataset.renderer='fallback';
      return;
    }
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000,0);
    renderer.domElement.setAttribute('aria-hidden','true');
    host.appendChild(renderer.domElement);
    host.dataset.renderer='webgl';

    const texture=createFontTexture(' .:-+*=%@#');
    const uniforms={
      uTime:{value:16},uMouse:{value:new THREE.Vector2()},uResolution:{value:new THREE.Vector2(1,1)},
      uFontTexture:{value:texture},uCharCount:{value:10},uColor:{value:new THREE.Color()},
      uInvert:{value:false},uScale:{value:3},uSize:{value:10},uSpeed:{value:.3},
      uHasMouse:{value:0},uIntensity:{value:1.3},uInteractIntensity:{value:0},
      uWaveTension:{value:.5},uWaveTwist:{value:.1},uVideoTexture:{value:null},uHasVideo:{value:false},
    };
    const material=new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms,transparent:true});
    const geometry=new THREE.PlaneGeometry(2,2);
    const scene=new THREE.Scene();
    scene.add(new THREE.Mesh(geometry,material));
    const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,10);
    camera.position.z=1;

    let frame=0,last=0,visible=true,lost=false;
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');
    const canAnimate=()=>!media.matches&&!document.hidden&&visible&&!lost;
    function draw(){
      if(!lost)renderer.render(scene,camera);
    }
    function tick(now:number){
      if(!canAnimate()){frame=0;return}
      if(now-last>=50) {
        // Clamp elapsed time after a background tab resumes.
        uniforms.uTime.value+=Math.min((now-last)/1000,.1);
        last=now;draw();
      }
      frame=requestAnimationFrame(tick);
    }
    function sync(){
      cancelAnimationFrame(frame);frame=0;
      host!.dataset.animation=canAnimate()?'running':'paused';
      last=performance.now();
      if(canAnimate())frame=requestAnimationFrame(tick);
      else if(!document.hidden&&visible)draw();
    }
    function resize(){
      const {width,height}=host!.getBoundingClientRect();
      if(width<1||height<1)return;
      renderer.setSize(width,height);
      uniforms.uResolution.value.set(width,height);
      draw();
    }
    function theme(){
      uniforms.uColor.value.set(getComputedStyle(host!).getPropertyValue('--ascii-color').trim()||'#355cce');
      draw();
    }
    function contextLost(event:Event){
      event.preventDefault();lost=true;
      host!.dataset.renderer='fallback';
      sync();
    }
    function contextRestored(){
      lost=false;host!.dataset.renderer='webgl';
      resize();theme();sync();
    }
    const resizeObserver=new ResizeObserver(resize);
    const intersection=new IntersectionObserver(entries=>{
      visible=entries[0]?.isIntersecting??false;sync();
    });
    const themeObserver=new MutationObserver(theme);
    resizeObserver.observe(host);
    intersection.observe(host);
    themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','data-accent']});
    media.addEventListener('change',sync);
    document.addEventListener('visibilitychange',sync);
    renderer.domElement.addEventListener('webglcontextlost',contextLost);
    renderer.domElement.addEventListener('webglcontextrestored',contextRestored);
    resize();theme();sync();
    return ()=>{
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();intersection.disconnect();themeObserver.disconnect();
      media.removeEventListener('change',sync);
      document.removeEventListener('visibilitychange',sync);
      renderer.domElement.removeEventListener('webglcontextlost',contextLost);
      renderer.domElement.removeEventListener('webglcontextrestored',contextRestored);
      texture.dispose();geometry.dispose();material.dispose();
      renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();
    };
  },[]);
  return <div ref={hostRef} className="sidebar-ascii" aria-hidden="true" data-animation="paused">
    <pre className="sidebar-ascii-fallback">{fallback}</pre>
  </div>;
}
