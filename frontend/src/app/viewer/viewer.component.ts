import { AfterViewInit, Component, ElementRef, Input, NgZone, OnChanges, OnDestroy, Output, EventEmitter, SimpleChanges, ViewChild, inject } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DepthBrushSettings, EditorHistoryState, GpuDiagnostics, ParallaxPath, SceneDocument, SceneLayer, ViewerMode } from '../models';

interface EditSnapshot { depth: Uint8ClampedArray; confidence: Uint8ClampedArray }
interface EditableMaps {
  width: number; height: number;
  depthCanvas: HTMLCanvasElement; depthContext: CanvasRenderingContext2D; depthTexture: THREE.CanvasTexture;
  invertedCanvas: HTMLCanvasElement; invertedContext: CanvasRenderingContext2D; invertedTexture: THREE.CanvasTexture;
  confidenceCanvas: HTMLCanvasElement; confidenceContext: CanvasRenderingContext2D; confidenceTexture: THREE.CanvasTexture;
  depthImage: ImageData; invertedImage: ImageData; confidenceImage: ImageData;
  original: EditSnapshot; undo: EditSnapshot[]; redo: EditSnapshot[];
}

@Component({ selector: 'aps-viewer', standalone: true, template: '<div #host class="host" [class.editing]="editorEnabled" aria-label="Interactive 3D viewport"><i class="brush-cursor" [class.visible]="cursorVisible" [style.width.px]="brush.size" [style.height.px]="brush.size" [style.transform]="cursorTransform"></i></div>', styles: [':host,.host{display:block;width:100%;height:100%;min-height:360px}.host{position:relative;overflow:hidden}.host.editing{cursor:none}.brush-cursor{position:absolute;z-index:4;left:0;top:0;display:none;border:1px solid #fff;border-radius:50%;box-shadow:0 0 0 1px #0008,0 0 12px #7767db99;pointer-events:none}.brush-cursor.visible{display:block}'] })
export class ViewerComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() scene: SceneDocument | null = null;
  @Input() mode: ViewerMode = '3d';
  @Input() comparisonUrl: string | null = null;
  @Input() separation = 1;
  @Input() soloLayerId: string | null = null;
  @Input() differenceGain = 8;
  @Input() editorEnabled = false;
  @Input() brush: DepthBrushSettings = { tool: 'near', size: 80, strength: .25 };
  @Output() historyChange = new EventEmitter<EditorHistoryState>();
  @Output() diagnostics = new EventEmitter<GpuDiagnostics>();
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;
  private readonly zone = inject(NgZone);
  private renderer?: THREE.WebGLRenderer; private world = new THREE.Scene(); private comparisonWorld = new THREE.Scene(); private comparisonCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); private camera?: THREE.PerspectiveCamera; private controls?: OrbitControls;
  private meshes = new Map<string, THREE.Mesh<THREE.PlaneGeometry, THREE.Material>>(); private comparison?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private frame = 0; private observer?: ResizeObserver; private previewStarted = 0; private previewPath: ParallaxPath = 'horizontal'; private zoomStarted = 0; private zoomFrom = 5; private zoomTo = 5; private zoomDirection = new THREE.Vector3(0, 0, 1); private comparisonRequest = 0;
  private editable?: EditableMaps; private drawing = false; private lastPaintUv?: THREE.Vector2;
  cursorVisible = false; cursorTransform = 'translate(-999px,-999px)';

  ngAfterViewInit(): void { this.setup(); if (this.scene) void this.loadScene(); }
  ngOnChanges(changes: SimpleChanges): void {
    if (!this.renderer) return;
    if (changes['scene']) void this.loadScene(); else if (changes['comparisonUrl'] && this.comparisonUrl) void this.loadComparison(); else this.applyLayers();
    if (changes['differenceGain'] && this.comparison) this.comparison.material.uniforms['gain'].value = this.mode === 'difference' ? this.differenceGain : 1;
    if (changes['editorEnabled'] && this.controls) { this.controls.enabled = !this.editorEnabled; if (!this.editorEnabled) { this.drawing = false; this.cursorVisible = false; } }
    this.applyMode();
  }
  ngOnDestroy(): void { cancelAnimationFrame(this.frame); this.observer?.disconnect(); this.controls?.dispose(); if (this.renderer) { const canvas = this.renderer.domElement; canvas.removeEventListener('pointerdown', this.onPointerDown); canvas.removeEventListener('pointermove', this.onPointerMove); canvas.removeEventListener('pointerup', this.onPointerUp); canvas.removeEventListener('pointercancel', this.onPointerUp); canvas.removeEventListener('pointerleave', this.onPointerLeave); } this.disposeComparison(); this.disposeMeshes(); this.renderer?.dispose(); }
  resetCamera(): void { if (!this.camera || !this.scene || !this.controls) return; this.previewStarted = 0; this.zoomStarted = 0; this.camera.position.fromArray(this.scene.camera.position); this.camera.up.set(0, 1, 0); this.controls.target.fromArray(this.scene.camera.target); this.camera.lookAt(this.controls.target); this.camera.updateMatrixWorld(true); this.controls.update(); }
  startParallaxPreview(path: ParallaxPath = 'horizontal'): void { this.resetCamera(); this.previewPath = path; this.previewStarted = performance.now(); }
  startZoom(direction: 'in' | 'out'): void { if (!this.camera || !this.controls) return; this.previewStarted = 0; this.zoomFrom = this.camera.position.distanceTo(this.controls.target); this.zoomTo = direction === 'in' ? this.controls.minDistance : this.controls.maxDistance; this.zoomDirection.copy(this.camera.position).sub(this.controls.target).normalize(); this.zoomStarted = performance.now(); }
  undoEdit(): void { if (!this.editable?.undo.length) return; const current = this.captureSnapshot(); const previous = this.editable.undo.pop(); if (!current || !previous) return; this.editable.redo.push(current); this.restoreSnapshot(previous); this.emitHistory(); }
  redoEdit(): void { if (!this.editable?.redo.length) return; const current = this.captureSnapshot(); const next = this.editable.redo.pop(); if (!current || !next) return; this.editable.undo.push(current); this.restoreSnapshot(next); this.emitHistory(); }
  resetEdits(): void { if (!this.editable) return; this.restoreSnapshot(this.editable.original); this.editable.undo = []; this.editable.redo = []; this.emitHistory(); }

  private setup(): void {
    const element = this.host.nativeElement;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.setClearColor(0x03050a); element.appendChild(this.renderer.domElement);
    Object.assign(this.renderer.domElement.style, { display: 'block', position: 'absolute', inset: '0', width: '100%', height: '100%' });
    this.camera = new THREE.PerspectiveCamera(45, 1, .1, 100); this.camera.position.set(0, 0, 5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true; this.controls.minDistance = 3.5; this.controls.maxDistance = 7; this.controls.maxPolarAngle = Math.PI / 2 + .31; this.controls.minPolarAngle = Math.PI / 2 - .31;
    this.controls.minAzimuthAngle = -.42; this.controls.maxAzimuthAngle = .42;
    this.controls.addEventListener('start', () => { this.previewStarted = 0; this.zoomStarted = 0; });
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown); this.renderer.domElement.addEventListener('pointermove', this.onPointerMove); this.renderer.domElement.addEventListener('pointerup', this.onPointerUp); this.renderer.domElement.addEventListener('pointercancel', this.onPointerUp); this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(element); this.resize();
    this.zone.runOutsideAngular(() => this.animate());
    this.emitDiagnostics();
  }
  private resize(): void { if (!this.renderer || !this.camera) return; const bounds = this.host.nativeElement.getBoundingClientRect(); const w = Math.round(bounds.width); const h = Math.round(bounds.height); if (!w || !h) return; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.clearViewOffset(); this.camera.filmOffset = 0; this.camera.updateProjectionMatrix(); this.sizeComparison(w / h); this.applyLayers(); }
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
        const confidenceTexture = layer.confidence_texture_url ? await loader.loadAsync(layer.confidence_texture_url) : depthTexture;
        confidenceTexture.colorSpace = THREE.NoColorSpace; confidenceTexture.flipY = true;
        const source = texture.image as { width?: number; height?: number };
        material = this.createWarpMaterial(texture, depthTexture, invertedDepthTexture, confidenceTexture, layer.opacity, layer.warp_strength ?? 0, layer.invert_depth ?? false, layer.fine_warp_ratio ?? .25, layer.confidence_amount ?? .7, source.width ?? 1, source.height ?? 1);
        this.editable = this.createEditableMaps(depthTexture.image as CanvasImageSource, confidenceTexture.image as CanvasImageSource, source.width ?? 1, source.height ?? 1);
        const shader = material as THREE.ShaderMaterial;
        shader.uniforms['depthMap'].value = this.editable.depthTexture; shader.uniforms['invertedDepthMap'].value = this.editable.invertedTexture; shader.uniforms['confidenceMap'].value = this.editable.confidenceTexture;
        depthTexture.dispose(); if (invertedDepthTexture !== depthTexture) invertedDepthTexture.dispose(); if (confidenceTexture !== depthTexture && confidenceTexture !== invertedDepthTexture) confidenceTexture.dispose();
      } else {
        material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, premultipliedAlpha: false, depthWrite: false, side: THREE.DoubleSide, opacity: layer.opacity });
      }
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material); mesh.renderOrder = layer.order; this.world.add(mesh); this.meshes.set(layer.id, mesh);
    }));
    if (this.comparisonUrl) await this.loadComparison(); this.applyLayers(); this.applyMode();
    this.emitHistory();
    this.emitDiagnostics();
  }

  private createEditableMaps(depthSource: CanvasImageSource, confidenceSource: CanvasImageSource, sourceWidth: number, sourceHeight: number): EditableMaps {
    const scale = Math.min(1, 1280 / Math.max(sourceWidth, sourceHeight)); const width = Math.max(1, Math.round(sourceWidth * scale)); const height = Math.max(1, Math.round(sourceHeight * scale));
    const make = (source: CanvasImageSource) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d', { willReadFrequently: true }); if (!context) throw new Error('Canvas 2D is unavailable'); context.drawImage(source, 0, 0, width, height); return { canvas, context }; };
    const depth = make(depthSource); const inverted = make(depthSource); const confidence = make(confidenceSource);
    const maps: EditableMaps = { width, height, depthCanvas: depth.canvas, depthContext: depth.context, depthTexture: new THREE.CanvasTexture(depth.canvas), invertedCanvas: inverted.canvas, invertedContext: inverted.context, invertedTexture: new THREE.CanvasTexture(inverted.canvas), confidenceCanvas: confidence.canvas, confidenceContext: confidence.context, confidenceTexture: new THREE.CanvasTexture(confidence.canvas), depthImage: depth.context.getImageData(0, 0, width, height), invertedImage: inverted.context.createImageData(width, height), confidenceImage: confidence.context.getImageData(0, 0, width, height), original: { depth: new Uint8ClampedArray(), confidence: new Uint8ClampedArray() }, undo: [], redo: [] };
    maps.depthTexture.colorSpace = maps.invertedTexture.colorSpace = maps.confidenceTexture.colorSpace = THREE.NoColorSpace;
    this.editable = maps; this.refreshInvertedMap(); maps.original = this.captureSnapshot()!; return maps;
  }
  private createWarpMaterial(texture: THREE.Texture, depthTexture: THREE.Texture, invertedDepthTexture: THREE.Texture, confidenceTexture: THREE.Texture, opacity: number, strength: number, inverted: boolean, fineWarpRatio: number, confidenceAmount: number, width: number, height: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, depthMap: { value: depthTexture }, invertedDepthMap: { value: invertedDepthTexture }, confidenceMap: { value: confidenceTexture }, viewOffset: { value: new THREE.Vector2() }, texelSize: { value: new THREE.Vector2(1 / width, 1 / height) }, strength: { value: strength }, opacity: { value: opacity }, invertDepth: { value: inverted ? 1 : 0 }, fineWarpRatio: { value: fineWarpRatio }, confidenceAmount: { value: confidenceAmount } },
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D map;
        uniform sampler2D depthMap;
        uniform sampler2D invertedDepthMap;
        uniform sampler2D confidenceMap;
        uniform vec2 viewOffset;
        uniform vec2 texelSize;
        uniform float strength;
        uniform float opacity;
        uniform float invertDepth;
        uniform float fineWarpRatio;
        uniform float confidenceAmount;
        varying vec2 vUv;
        vec4 softSample(vec2 uv) {
          vec2 radius = texelSize * 3.0;
          vec4 center = texture2D(map, uv) * 0.4;
          vec4 axis = texture2D(map, clamp(uv + vec2(radius.x, 0.0), vec2(0.001), vec2(0.999)))
            + texture2D(map, clamp(uv - vec2(radius.x, 0.0), vec2(0.001), vec2(0.999)))
            + texture2D(map, clamp(uv + vec2(0.0, radius.y), vec2(0.001), vec2(0.999)))
            + texture2D(map, clamp(uv - vec2(0.0, radius.y), vec2(0.001), vec2(0.999)));
          return center + axis * 0.15;
        }
        void main() {
          float sampledDepth = mix(texture2D(depthMap, vUv).r, texture2D(invertedDepthMap, vUv).r, invertDepth);
          float depth = sampledDepth - 0.5;
          float confidence = mix(1.0, texture2D(confidenceMap, vUv).r, confidenceAmount);
          vec2 broadOffset = vec2(-viewOffset.x, viewOffset.y) * depth * strength * confidence;
          vec2 broadUv = 1.0 - abs(mod(vUv + broadOffset, 2.0) - 1.0);
          vec2 fineUv = 1.0 - abs(mod(vUv + broadOffset * fineWarpRatio, 2.0) - 1.0);
          vec4 broadColor = softSample(broadUv);
          vec4 fineColor = texture2D(map, fineUv) - softSample(fineUv);
          vec4 color = clamp(broadColor + fineColor, 0.0, 1.0);
          gl_FragColor = vec4(color.rgb, color.a * opacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
  }
  private async loadComparison(): Promise<void> {
    const url = this.comparisonUrl; if (!url) return; const request = ++this.comparisonRequest;
    const texture = await new THREE.TextureLoader().loadAsync(url); if (request !== this.comparisonRequest) { texture.dispose(); return; } this.disposeComparison(); texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = true;
    const material = new THREE.ShaderMaterial({ uniforms: { map: { value: texture }, gain: { value: this.mode === 'difference' ? this.differenceGain : 1 } }, vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`, fragmentShader: `uniform sampler2D map;
      uniform float gain; varying vec2 vUv;
      void main(){
        vec4 color=texture2D(map,vUv);
        gl_FragColor=vec4(clamp(color.rgb*gain,0.0,1.0),1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`, depthTest: false, depthWrite: false });
    this.comparison = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material); this.comparison.position.z = -.5; this.comparisonWorld.add(this.comparison); const bounds = this.host.nativeElement.getBoundingClientRect(); this.sizeComparison(bounds.width / Math.max(1, bounds.height)); this.applyMode();
  }
  private sizeComparison(viewportAspect: number): void { if (!this.comparison || !this.scene) return; const imageAspect = this.scene.source.width / this.scene.source.height; if (viewportAspect > imageAspect) this.comparison.scale.set(imageAspect / viewportAspect, 1, 1); else this.comparison.scale.set(1, viewportAspect / imageAspect, 1); }
  private disposeComparison(): void { if (!this.comparison) return; this.comparisonWorld.remove(this.comparison); this.comparison.geometry.dispose(); (this.comparison.material.uniforms['map'].value as THREE.Texture).dispose(); this.comparison.material.dispose(); this.comparison = undefined; }
  private sizePlane(mesh: THREE.Mesh, depth: number, position: {x:number;y:number;z:number}, scale: {x:number;y:number;z:number}): void {
    if (!this.scene || !this.camera) return; const distance = this.scene.camera.position[2] - depth; const height = 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)); const width = height * this.scene.source.width / this.scene.source.height;
    mesh.position.set(position.x, position.y, depth + position.z); mesh.scale.set(width * scale.x, height * scale.y, scale.z);
  }
  private applyLayers(): void { if (!this.scene) return; for (const layer of this.scene.layers) { const mesh = this.meshes.get(layer.id); if (!mesh) continue; mesh.visible = this.mode === '3d' && layer.visible && (!this.soloLayerId || this.soloLayerId === layer.id); if (mesh.material instanceof THREE.ShaderMaterial) { mesh.material.uniforms['opacity'].value = layer.opacity; mesh.material.uniforms['strength'].value = layer.warp_strength ?? 0; mesh.material.uniforms['invertDepth'].value = layer.invert_depth ? 1 : 0; mesh.material.uniforms['fineWarpRatio'].value = layer.fine_warp_ratio ?? .25; mesh.material.uniforms['confidenceAmount'].value = layer.confidence_amount ?? .7; } else if (mesh.material instanceof THREE.MeshBasicMaterial) { mesh.material.opacity = layer.opacity; } this.sizePlane(mesh, layer.depth * this.separation, layer.transform.position, layer.transform.scale); } }
  private applyMode(): void { if (!this.scene) return; for (const layer of this.scene.layers) { const mesh = this.meshes.get(layer.id); if (mesh) mesh.visible = this.mode === '3d' && layer.visible && (!this.soloLayerId || this.soloLayerId === layer.id); } }
  private onPointerDown = (event: PointerEvent): void => {
    if (!this.editorEnabled || event.button !== 0) return; const uv = this.pointerUv(event); if (!uv || !this.editable) return;
    event.preventDefault(); this.renderer?.domElement.setPointerCapture(event.pointerId); const before = this.captureSnapshot(); if (before) { this.editable.undo.push(before); if (this.editable.undo.length > 12) this.editable.undo.shift(); this.editable.redo = []; }
    this.drawing = true; this.lastPaintUv = uv; this.paintAt(uv); this.emitHistory();
  };
  private onPointerMove = (event: PointerEvent): void => {
    if (!this.editorEnabled) return; const bounds = this.host.nativeElement.getBoundingClientRect(); this.cursorTransform = `translate(${event.clientX - bounds.left - this.brush.size / 2}px,${event.clientY - bounds.top - this.brush.size / 2}px)`; this.cursorVisible = true;
    if (!this.drawing) return; const uv = this.pointerUv(event); if (!uv || !this.lastPaintUv) return;
    const distance = uv.distanceTo(this.lastPaintUv); const spacing = Math.max(.002, this.brush.size / Math.max(bounds.width, bounds.height) * .18); const steps = Math.max(1, Math.ceil(distance / spacing)); const from = this.lastPaintUv.clone(); for (let step = 1; step <= steps; step++) this.paintAt(from.clone().lerp(uv, step / steps)); this.lastPaintUv = uv;
  };
  private onPointerUp = (event: PointerEvent): void => { if (!this.drawing) return; this.drawing = false; this.lastPaintUv = undefined; if (this.renderer?.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId); };
  private onPointerLeave = (): void => { if (!this.drawing) this.cursorVisible = false; };
  private pointerUv(event: PointerEvent): THREE.Vector2 | null {
    if (!this.camera || !this.scene) return null; const canvas = this.renderer?.domElement; if (!canvas) return null; const bounds = canvas.getBoundingClientRect(); const pointer = new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1); const nebula = this.scene.layers.find(layer => layer.type === 'nebula'); const mesh = nebula ? this.meshes.get(nebula.id) : undefined; if (!mesh) return null; const raycaster = new THREE.Raycaster(); raycaster.setFromCamera(pointer, this.camera); const hit = raycaster.intersectObject(mesh, false)[0]; return hit?.uv?.clone() ?? null;
  }
  private paintAt(uv: THREE.Vector2): void {
    const maps = this.editable; if (!maps) return; const target = this.brush.tool === 'protect' ? maps.confidenceContext : maps.depthContext; const image = this.brush.tool === 'protect' ? maps.confidenceImage : maps.depthImage; const source = image.data; const bounds = this.host.nativeElement.getBoundingClientRect(); const radiusX = Math.max(1, this.brush.size * .5 / bounds.width * maps.width); const radiusY = Math.max(1, this.brush.size * .5 / bounds.height * maps.height); const centerX = uv.x * maps.width; const centerY = (1 - uv.y) * maps.height; const minX = Math.max(0, Math.floor(centerX - radiusX)); const maxX = Math.min(maps.width - 1, Math.ceil(centerX + radiusX)); const minY = Math.max(0, Math.floor(centerY - radiusY)); const maxY = Math.min(maps.height - 1, Math.ceil(centerY + radiusY)); const inverted = this.scene?.layers.find(layer => layer.type === 'nebula')?.invert_depth ?? false;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) { const distance = Math.hypot((x - centerX) / radiusX, (y - centerY) / radiusY); if (distance >= 1) continue; const weight = (1 - distance) * (1 - distance) * this.brush.strength; const index = (y * maps.width + x) * 4; let value = image.data[index];
      if (this.brush.tool === 'near' || this.brush.tool === 'far') { const activeDirection = this.brush.tool === 'near' ? 1 : -1; value += activeDirection * (inverted ? -1 : 1) * 56 * weight; }
      else if (this.brush.tool === 'protect') value += (0 - value) * Math.min(1, weight * .35);
      else { let total = 0; let count = 0; for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) { const sx = Math.min(maps.width - 1, Math.max(0, x + ox)); const sy = Math.min(maps.height - 1, Math.max(0, y + oy)); total += source[(sy * maps.width + sx) * 4]; count++; } value += (total / count - value) * Math.min(1, weight * .7); }
      value = Math.max(0, Math.min(255, value)); image.data[index] = image.data[index + 1] = image.data[index + 2] = value; image.data[index + 3] = 255;
    }
    target.putImageData(image, 0, 0, minX, minY, maxX - minX + 1, maxY - minY + 1); if (this.brush.tool !== 'protect') this.refreshInvertedMap(minX, minY, maxX, maxY); else maps.confidenceTexture.needsUpdate = true;
  }
  private refreshInvertedMap(minX = 0, minY = 0, maxX?: number, maxY?: number): void { const maps = this.editable; if (!maps) return; const endX = maxX ?? maps.width - 1; const endY = maxY ?? maps.height - 1; for (let y = minY; y <= endY; y++) for (let x = minX; x <= endX; x++) { const index = (y * maps.width + x) * 4; const value = 255 - maps.depthImage.data[index]; maps.invertedImage.data[index] = maps.invertedImage.data[index + 1] = maps.invertedImage.data[index + 2] = value; maps.invertedImage.data[index + 3] = 255; } maps.invertedContext.putImageData(maps.invertedImage, 0, 0, minX, minY, endX - minX + 1, endY - minY + 1); maps.depthTexture.needsUpdate = true; maps.invertedTexture.needsUpdate = true; }
  private captureSnapshot(): EditSnapshot | undefined { const maps = this.editable; if (!maps) return undefined; return { depth: new Uint8ClampedArray(maps.depthImage.data), confidence: new Uint8ClampedArray(maps.confidenceImage.data) }; }
  private restoreSnapshot(snapshot: EditSnapshot): void { const maps = this.editable; if (!maps) return; maps.depthImage.data.set(snapshot.depth); maps.confidenceImage.data.set(snapshot.confidence); maps.depthContext.putImageData(maps.depthImage, 0, 0); maps.confidenceContext.putImageData(maps.confidenceImage, 0, 0); maps.confidenceTexture.needsUpdate = true; this.refreshInvertedMap(); }
  private emitHistory(): void { this.historyChange.emit({ canUndo: !!this.editable?.undo.length, canRedo: !!this.editable?.redo.length, modified: !!this.editable?.undo.length }); }
  private emitDiagnostics(): void { if (!this.renderer) return; const gl = this.renderer.getContext(); const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number; const parameters = this.scene?.processing.parameters; const previewWidth = Number(parameters?.['previewWidth'] ?? this.scene?.source.width ?? 0); const previewHeight = Number(parameters?.['previewHeight'] ?? this.scene?.source.height ?? 0); this.diagnostics.emit({ maxTextureSize, renderer: gl.getParameter(gl.RENDERER) as string, previewWidth, previewHeight, sourceTooLarge: !!this.scene && Math.max(this.scene.source.width, this.scene.source.height) > maxTextureSize }); }
  private animate = (): void => {
    this.frame = requestAnimationFrame(this.animate);
    if (this.previewStarted && this.camera && this.controls) { const elapsed = performance.now() - this.previewStarted; const duration = 4200; if (elapsed < duration) { const phase = elapsed / duration; const envelope = Math.sin(phase * Math.PI); const angle = phase * Math.PI * 2; const horizontalRange = this.previewPath === 'orbit' ? .72 : .82; const verticalRange = this.previewPath === 'orbit' ? .48 : .58; const x = this.previewPath === 'vertical' ? 0 : Math.sin(angle) * horizontalRange * envelope; const y = this.previewPath === 'horizontal' ? 0 : (this.previewPath === 'orbit' ? Math.cos(angle) : Math.sin(angle)) * verticalRange * envelope; this.camera.position.set(this.controls.target.x + x, this.controls.target.y + y, this.scene?.camera.position[2] ?? 5); this.controls.update(); } else { this.previewStarted = 0; this.resetCamera(); } }
    if (this.zoomStarted && this.camera && this.controls) { const phase = Math.min(1, (performance.now() - this.zoomStarted) / 5000); const eased = phase * phase * phase * (phase * (phase * 6 - 15) + 10); const distance = THREE.MathUtils.lerp(this.zoomFrom, this.zoomTo, eased); this.camera.position.copy(this.controls.target).addScaledVector(this.zoomDirection, distance); this.controls.update(); if (phase >= 1) this.zoomStarted = 0; }
    if (this.controls && !this.previewStarted) { this.controls.target.x = THREE.MathUtils.clamp(this.controls.target.x, -.35, .35); this.controls.target.y = THREE.MathUtils.clamp(this.controls.target.y, -.35, .35); this.controls.update(); }
    if (this.camera && this.controls && this.scene) { const origin = this.scene.camera.position; const target = this.scene.camera.target; const relativeX = (this.camera.position.x - this.controls.target.x) - (origin[0] - target[0]); const relativeY = (this.camera.position.y - this.controls.target.y) - (origin[1] - target[1]); for (const mesh of this.meshes.values()) if (mesh.material instanceof THREE.ShaderMaterial) mesh.material.uniforms['viewOffset'].value.set(relativeX, relativeY); }
    if (this.renderer && this.camera) { if (this.mode === '3d') this.renderer.render(this.world, this.camera); else this.renderer.render(this.comparisonWorld, this.comparisonCamera); }
  };
  private disposeMeshes(): void { for (const mesh of this.meshes.values()) { this.world.remove(mesh); mesh.geometry.dispose(); if (mesh.material instanceof THREE.ShaderMaterial) { (mesh.material.uniforms['map'].value as THREE.Texture).dispose(); const depthMap = mesh.material.uniforms['depthMap'].value as THREE.Texture; const invertedDepthMap = mesh.material.uniforms['invertedDepthMap'].value as THREE.Texture; const confidenceMap = mesh.material.uniforms['confidenceMap'].value as THREE.Texture; depthMap.dispose(); if (invertedDepthMap !== depthMap) invertedDepthMap.dispose(); if (confidenceMap !== depthMap && confidenceMap !== invertedDepthMap) confidenceMap.dispose(); } else if (mesh.material instanceof THREE.MeshBasicMaterial) mesh.material.map?.dispose(); mesh.material.dispose(); } this.meshes.clear(); this.editable = undefined; this.emitHistory(); }
}
