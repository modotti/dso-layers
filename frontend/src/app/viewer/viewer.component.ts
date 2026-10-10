import { AfterViewInit, Component, ElementRef, Input, NgZone, OnChanges, OnDestroy, SimpleChanges, ViewChild, inject } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SceneDocument, SceneLayer, ViewerMode } from '../models';

@Component({ selector: 'aps-viewer', standalone: true, template: '<div #host class="host" aria-label="Interactive 3D viewport"></div>', styles: [':host,.host{display:block;width:100%;height:100%;min-height:360px}.host{position:relative;overflow:hidden}'] })
export class ViewerComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() scene: SceneDocument | null = null;
  @Input() mode: ViewerMode = '3d';
  @Input() comparisonUrl: string | null = null;
  @Input() separation = 1;
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;
  private readonly zone = inject(NgZone);
  private renderer?: THREE.WebGLRenderer; private world = new THREE.Scene(); private camera?: THREE.PerspectiveCamera; private controls?: OrbitControls;
  private meshes = new Map<string, THREE.Mesh<THREE.PlaneGeometry, THREE.Material>>(); private comparison?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private frame = 0; private observer?: ResizeObserver; private previewStarted = 0;

  ngAfterViewInit(): void { this.setup(); if (this.scene) void this.loadScene(); }
  ngOnChanges(changes: SimpleChanges): void {
    if (!this.renderer) return;
    if (changes['scene']) void this.loadScene(); else if (changes['comparisonUrl'] && this.comparisonUrl) void this.loadComparison(); else this.applyLayers();
    this.applyMode();
  }
  ngOnDestroy(): void { cancelAnimationFrame(this.frame); this.observer?.disconnect(); this.controls?.dispose(); this.disposeMeshes(); this.renderer?.dispose(); }
  resetCamera(): void { if (!this.camera || !this.scene || !this.controls) return; this.camera.position.fromArray(this.scene.camera.position); this.camera.up.set(0, 1, 0); this.controls.target.fromArray(this.scene.camera.target); this.camera.lookAt(this.controls.target); this.camera.updateMatrixWorld(true); this.controls.update(); }
  startParallaxPreview(): void { this.resetCamera(); this.previewStarted = performance.now(); }

  private setup(): void {
    const element = this.host.nativeElement;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.setClearColor(0x03050a); element.appendChild(this.renderer.domElement);
    Object.assign(this.renderer.domElement.style, { display: 'block', position: 'absolute', inset: '0', width: '100%', height: '100%' });
    this.camera = new THREE.PerspectiveCamera(45, 1, .1, 100); this.camera.position.set(0, 0, 5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true; this.controls.minDistance = 3.5; this.controls.maxDistance = 7; this.controls.maxPolarAngle = Math.PI / 2 + .31; this.controls.minPolarAngle = Math.PI / 2 - .31;
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(element); this.resize();
    this.zone.runOutsideAngular(() => this.animate());
  }
  private resize(): void { if (!this.renderer || !this.camera) return; const bounds = this.host.nativeElement.getBoundingClientRect(); const w = Math.round(bounds.width); const h = Math.round(bounds.height); if (!w || !h) return; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.clearViewOffset(); this.camera.filmOffset = 0; this.camera.updateProjectionMatrix(); this.applyLayers(); }
  private async loadScene(): Promise<void> {
    this.disposeMeshes(); if (!this.scene || !this.camera || !this.controls) return;
    this.camera.fov = this.scene.camera.fov; this.camera.near = this.scene.camera.near; this.camera.far = this.scene.camera.far; this.controls.minDistance = this.scene.camera.min_distance; this.controls.maxDistance = this.scene.camera.max_distance; this.resetCamera();
    const loader = new THREE.TextureLoader();
    await Promise.all(this.scene.layers.map(async layer => {
      const texture = await loader.loadAsync(layer.texture_url); texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = true;
      let material: THREE.Material;
      if (layer.depth_texture_url) {
        const depthTexture = await loader.loadAsync(layer.depth_texture_url); depthTexture.colorSpace = THREE.NoColorSpace; depthTexture.flipY = true;
        const invertedDepthTexture = layer.inverted_depth_texture_url ? await loader.loadAsync(layer.inverted_depth_texture_url) : depthTexture;
        invertedDepthTexture.colorSpace = THREE.NoColorSpace; invertedDepthTexture.flipY = true;
        material = this.createWarpMaterial(texture, depthTexture, invertedDepthTexture, layer.opacity, layer.warp_strength ?? 0, layer.invert_depth ?? false);
      } else {
        material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, premultipliedAlpha: false, depthWrite: false, side: THREE.DoubleSide, opacity: layer.opacity });
      }
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material); mesh.renderOrder = layer.order; this.world.add(mesh); this.meshes.set(layer.id, mesh);
    }));
    if (this.comparisonUrl) await this.loadComparison(); this.applyLayers(); this.applyMode();
  }
  private createWarpMaterial(texture: THREE.Texture, depthTexture: THREE.Texture, invertedDepthTexture: THREE.Texture, opacity: number, strength: number, inverted: boolean): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, depthMap: { value: depthTexture }, invertedDepthMap: { value: invertedDepthTexture }, viewOffset: { value: new THREE.Vector2() }, strength: { value: strength }, opacity: { value: opacity }, invertDepth: { value: inverted ? 1 : 0 } },
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D map;
        uniform sampler2D depthMap;
        uniform sampler2D invertedDepthMap;
        uniform vec2 viewOffset;
        uniform float strength;
        uniform float opacity;
        uniform float invertDepth;
        varying vec2 vUv;
        void main() {
          float sampledDepth = mix(texture2D(depthMap, vUv).r, texture2D(invertedDepthMap, vUv).r, invertDepth);
          float depth = sampledDepth - 0.5;
          vec2 offset = vec2(-viewOffset.x, viewOffset.y) * depth * strength;
          vec2 warpedUv = clamp(vUv + offset, vec2(0.001), vec2(0.999));
          vec4 color = texture2D(map, warpedUv);
          gl_FragColor = vec4(color.rgb, color.a * opacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
  }
  private async loadComparison(): Promise<void> {
    if (!this.comparisonUrl) return; if (this.comparison) { this.world.remove(this.comparison); this.comparison.geometry.dispose(); this.comparison.material.map?.dispose(); this.comparison.material.dispose(); }
    const texture = await new THREE.TextureLoader().loadAsync(this.comparisonUrl); texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = true;
    this.comparison = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texture, depthWrite: false })); this.comparison.renderOrder = 999; this.world.add(this.comparison); this.sizePlane(this.comparison, 0, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }); this.applyMode();
  }
  private sizePlane(mesh: THREE.Mesh, depth: number, position: {x:number;y:number;z:number}, scale: {x:number;y:number;z:number}): void {
    if (!this.scene || !this.camera) return; const distance = this.scene.camera.position[2] - depth; const height = 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)); const width = height * this.scene.source.width / this.scene.source.height;
    mesh.position.set(position.x, position.y, depth + position.z); mesh.scale.set(width * scale.x, height * scale.y, scale.z);
  }
  private applyLayers(): void { if (!this.scene) return; for (const layer of this.scene.layers) { const mesh = this.meshes.get(layer.id); if (!mesh) continue; mesh.visible = this.mode === '3d' && layer.visible; if (mesh.material instanceof THREE.ShaderMaterial) { mesh.material.uniforms['opacity'].value = layer.opacity; mesh.material.uniforms['strength'].value = layer.warp_strength ?? 0; mesh.material.uniforms['invertDepth'].value = layer.invert_depth ? 1 : 0; } else if (mesh.material instanceof THREE.MeshBasicMaterial) { mesh.material.opacity = layer.opacity; } this.sizePlane(mesh, layer.depth * this.separation, layer.transform.position, layer.transform.scale); } }
  private applyMode(): void { for (const mesh of this.meshes.values()) mesh.visible = this.mode === '3d' && (this.scene?.layers.find(l => l.id === [...this.meshes.entries()].find(([,m]) => m === mesh)?.[0])?.visible ?? true); if (this.comparison) this.comparison.visible = this.mode !== '3d'; }
  private animate = (): void => { this.frame = requestAnimationFrame(this.animate); if (this.previewStarted && this.camera && this.controls) { const elapsed = performance.now() - this.previewStarted; const duration = 4200; if (elapsed < duration) { const phase = elapsed / duration; const targetX = this.controls.target.x; this.camera.position.x = targetX + Math.sin(phase * Math.PI * 2) * .34 * Math.sin(phase * Math.PI); this.controls.update(); } else { this.previewStarted = 0; this.resetCamera(); } } this.controls?.update(); if (this.camera && this.controls && this.scene) { const origin = this.scene.camera.position; const target = this.scene.camera.target; const relativeX = (this.camera.position.x - this.controls.target.x) - (origin[0] - target[0]); const relativeY = (this.camera.position.y - this.controls.target.y) - (origin[1] - target[1]); for (const mesh of this.meshes.values()) if (mesh.material instanceof THREE.ShaderMaterial) mesh.material.uniforms['viewOffset'].value.set(relativeX, relativeY); } if (this.renderer && this.camera) this.renderer.render(this.world, this.camera); };
  private disposeMeshes(): void { for (const mesh of this.meshes.values()) { this.world.remove(mesh); mesh.geometry.dispose(); if (mesh.material instanceof THREE.ShaderMaterial) { (mesh.material.uniforms['map'].value as THREE.Texture).dispose(); const depthMap = mesh.material.uniforms['depthMap'].value as THREE.Texture; const invertedDepthMap = mesh.material.uniforms['invertedDepthMap'].value as THREE.Texture; depthMap.dispose(); if (invertedDepthMap !== depthMap) invertedDepthMap.dispose(); } else if (mesh.material instanceof THREE.MeshBasicMaterial) mesh.material.map?.dispose(); mesh.material.dispose(); } this.meshes.clear(); }
}
