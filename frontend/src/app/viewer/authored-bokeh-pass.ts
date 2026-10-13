import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { BokehShader } from 'three/examples/jsm/shaders/BokehShader.js';

export interface AuthoredBokehOptions { focus: number; aperture: number; maxblur: number }
export type BokehQuality = 'preview' | 'high';

const previewFragmentShader = /* glsl */`
  #include <common>
  #include <packing>
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform float focus;
  uniform float aperture;
  uniform float maxblur;
  uniform float nearClip;
  uniform float farClip;
  uniform float aspect;
  void main() {
    float depth = texture2D(tDepth, vUv).x;
    float viewZ = perspectiveDepthToViewZ(depth, nearClip, farClip);
    vec2 blur = vec2(clamp((focus + viewZ) * aperture, -maxblur, maxblur));
    vec2 ratio = vec2(1.0, aspect);
    vec4 color = texture2D(tColor, vUv);
    color += texture2D(tColor, vUv + vec2( 0.0000,  0.4000) * ratio * blur);
    color += texture2D(tColor, vUv + vec2( 0.3464,  0.2000) * ratio * blur);
    color += texture2D(tColor, vUv + vec2( 0.3464, -0.2000) * ratio * blur);
    color += texture2D(tColor, vUv + vec2( 0.0000, -0.4000) * ratio * blur);
    color += texture2D(tColor, vUv + vec2(-0.3464, -0.2000) * ratio * blur);
    color += texture2D(tColor, vUv + vec2(-0.3464,  0.2000) * ratio * blur);
    color += texture2D(tColor, vUv + vec2( 0.0000,  0.8000) * ratio * blur);
    color += texture2D(tColor, vUv + vec2( 0.6928,  0.4000) * ratio * blur);
    color += texture2D(tColor, vUv + vec2( 0.6928, -0.4000) * ratio * blur);
    color += texture2D(tColor, vUv + vec2( 0.0000, -0.8000) * ratio * blur);
    color += texture2D(tColor, vUv + vec2(-0.6928, -0.4000) * ratio * blur);
    color += texture2D(tColor, vUv + vec2(-0.6928,  0.4000) * ratio * blur);
    gl_FragColor = vec4((color / 13.0).rgb, 1.0);
  }`;

/** BokehPass variant that consumes an alpha-aware depth scene instead of overriding the color scene materials. */
export class AuthoredBokehPass extends Pass {
  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly depthTarget = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType });
  private readonly previewMaterial: THREE.ShaderMaterial;
  private readonly highMaterial: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly previousClearColor = new THREE.Color();

  constructor(private readonly depthScene: THREE.Scene, private readonly camera: THREE.PerspectiveCamera, options: AuthoredBokehOptions) {
    super();
    this.depthTarget.texture.name = 'AuthoredBokehPass.depth';
    this.uniforms = THREE.UniformsUtils.clone(BokehShader.uniforms) as Record<string, THREE.IUniform>;
    this.uniforms['tDepth'].value = this.depthTarget.texture;
    this.uniforms['focus'].value = options.focus;
    this.uniforms['aspect'].value = camera.aspect;
    this.uniforms['aperture'].value = options.aperture;
    this.uniforms['maxblur'].value = options.maxblur;
    this.uniforms['nearClip'].value = camera.near;
    this.uniforms['farClip'].value = camera.far;
    this.previewMaterial = new THREE.ShaderMaterial({
      defines: { ...BokehShader.defines, DEPTH_PACKING: 0 },
      uniforms: this.uniforms,
      vertexShader: BokehShader.vertexShader,
      fragmentShader: previewFragmentShader,
    });
    this.highMaterial = new THREE.ShaderMaterial({
      defines: { ...BokehShader.defines, DEPTH_PACKING: 0 },
      uniforms: this.uniforms,
      vertexShader: BokehShader.vertexShader,
      fragmentShader: BokehShader.fragmentShader,
    });
    this.quad = new FullScreenQuad(this.previewMaterial);
  }

  setQuality(quality: BokehQuality): void { this.quad.material = quality === 'high' ? this.highMaterial : this.previewMaterial; }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    renderer.getClearColor(this.previousClearColor);
    const previousClearAlpha = renderer.getClearAlpha();
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(0xffffff, 1);
    renderer.setRenderTarget(this.depthTarget);
    renderer.clear();
    renderer.render(this.depthScene, this.camera);

    this.uniforms['tColor'].value = readBuffer.texture;
    this.uniforms['nearClip'].value = this.camera.near;
    this.uniforms['farClip'].value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (!this.renderToScreen) renderer.clear();
    this.quad.render(renderer);

    renderer.setClearColor(this.previousClearColor, previousClearAlpha);
    renderer.autoClear = previousAutoClear;
  }

  override setSize(width: number, height: number): void {
    this.uniforms['aspect'].value = width / Math.max(1, height);
    this.depthTarget.setSize(width, height);
  }

  override dispose(): void { this.depthTarget.dispose(); this.previewMaterial.dispose(); this.highMaterial.dispose(); this.quad.dispose(); }
}
