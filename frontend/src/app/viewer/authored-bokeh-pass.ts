import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { BokehShader } from 'three/examples/jsm/shaders/BokehShader.js';

export interface AuthoredBokehOptions { focus: number; aperture: number; maxblur: number }

/** BokehPass variant that consumes an alpha-aware depth scene instead of overriding the color scene materials. */
export class AuthoredBokehPass extends Pass {
  readonly uniforms: Record<string, THREE.IUniform>;
  private readonly depthTarget = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType });
  private readonly material: THREE.ShaderMaterial;
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
    this.material = new THREE.ShaderMaterial({
      defines: { ...BokehShader.defines, DEPTH_PACKING: 0 },
      uniforms: this.uniforms,
      vertexShader: BokehShader.vertexShader,
      fragmentShader: BokehShader.fragmentShader,
    });
    this.quad = new FullScreenQuad(this.material);
  }

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

  override dispose(): void { this.depthTarget.dispose(); this.material.dispose(); this.quad.dispose(); }
}
