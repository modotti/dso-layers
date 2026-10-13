import { AfterViewInit, Component, ElementRef, Input, NgZone, OnChanges, OnDestroy, Output, EventEmitter, SimpleChanges, ViewChild, inject } from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ApiService } from '../api.service';
import { CameraMovement, CameraPathEasing, CameraPathFlow, CameraPathPose, CameraPathState, DepthBrushSettings, DepthOfFieldSettings, EditorHistoryState, GpuDiagnostics, LightingSettings, ParallaxPath, SceneDocument, SceneLayer, TextOverlay, VideoExportSettings, VideoExportState, ViewerMode } from '../models';
import { createRandomCameraSequence } from '../random-camera-sequence';
import { videoCaptureBitrate } from '../video-export';
import { effectiveLayerDepth } from '../layer-depth';
import { cinematicPathPhase } from '../camera-path-flow';
import { textOverlayOpacity } from '../text-overlay';
import { focusDistanceAlongView, interpolateFocusDistance, perspectiveDepthForDistance } from '../focus-distance';
import { AuthoredBokehPass } from './authored-bokeh-pass';

interface EditSnapshot { depth: Uint8ClampedArray; confidence: Uint8ClampedArray }
interface EditableMaps {
  width: number; height: number;
  depthCanvas: HTMLCanvasElement; depthContext: CanvasRenderingContext2D; depthTexture: THREE.CanvasTexture;
  invertedCanvas: HTMLCanvasElement; invertedContext: CanvasRenderingContext2D; invertedTexture: THREE.CanvasTexture;
  confidenceCanvas: HTMLCanvasElement; confidenceContext: CanvasRenderingContext2D; confidenceTexture: THREE.CanvasTexture;
  depthImage: ImageData; invertedImage: ImageData; confidenceImage: ImageData;
  original: EditSnapshot; undo: EditSnapshot[]; redo: EditSnapshot[];
}
interface TextOverlayMesh { overlay: TextOverlay; mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; selection?: THREE.LineLoop; baseY: number }

@Component({ selector: 'aps-viewer', standalone: true, template: '<div #host class="host" [class.editing]="editorEnabled" aria-label="Interactive 3D viewport"><i class="brush-cursor" [class.visible]="cursorVisible" [style.width.px]="brush.size" [style.height.px]="brush.size" [style.transform]="cursorTransform"></i><i class="export-frame" [class.visible]="scene && mode===\'3d\' && !exporting" [style.width.px]="exportFrameWidth" [style.height.px]="exportFrameHeight"></i><span #playbackTimer class="playback-time"></span><div class="export-cover" [class.visible]="exporting" aria-live="polite"><img [src]="exportPreviewUrl" alt=""><strong>{{ exportStatus }}</strong><span>{{ exportStatusDetail }}</span></div></div>', styles: [':host,.host{display:block;width:100%;height:100%;min-height:360px}.host{position:relative;overflow:hidden}.host.editing{cursor:none}.brush-cursor{position:absolute;z-index:4;left:0;top:0;display:none;border:1px solid #fff;border-radius:50%;box-shadow:0 0 0 1px #0008,0 0 12px #7767db99;pointer-events:none}.brush-cursor.visible{display:block}.export-frame{position:absolute;z-index:2;left:50%;top:50%;display:none;box-sizing:border-box;transform:translate(-50%,-50%);border:1px dashed #b5a7ff99;border-radius:4px;box-shadow:0 0 0 9999px #02040a2b,inset 0 0 18px #0004,0 0 14px #7767db22;pointer-events:none}.export-frame.visible{display:block}.playback-time{position:absolute;z-index:4;top:62px;right:18px;display:none;min-width:48px;padding:5px 8px;border:1px solid #343b50;border-radius:6px;color:#e7e2ff;background:#0b0f18d9;font:600 11px Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums;text-align:center;pointer-events:none}.playback-time.visible{display:block}.export-cover{position:absolute;z-index:5;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;overflow:hidden;background:#05070c;color:#e8edf8;pointer-events:all}.export-cover.visible{display:flex}.export-cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.38;filter:blur(2px)}.export-cover:after{content:"";position:absolute;inset:0;background:radial-gradient(circle,#11162b88,#03050ae8 72%)}.export-cover strong,.export-cover span{position:relative;z-index:1}.export-cover strong{font-size:15px;letter-spacing:.04em}.export-cover span{margin-top:7px;color:#969fb2;font-size:11px}'] })
export class ViewerComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() scene: SceneDocument | null = null;
  @Input() mode: ViewerMode = '3d';
  @Input() comparisonUrl: string | null = null;
  @Input() separation = 1;
  @Input() starPresence = 1;
  @Input() soloLayerId: string | null = null;
  @Input() differenceGain = 8;
  @Input() lighting: LightingSettings = { intensity: .06, relief: 1.2, direction: 135 };
  @Input() depthOfField: DepthOfFieldSettings = { enabled: false, focusMode: 'starless', focusLayerId: null, focusDistance: 5, aperture: .002, maxBlur: .006 };
  @Input() cameraPath: CameraPathState = {};
  @Input() cameraMovements: CameraMovement[] = [];
  @Input() cameraRoll = 0;
  @Input() cameraPathDuration = 7;
  @Input() cameraPathEasing: CameraPathEasing = 'ease-in-out';
  @Input() cameraPathFlow: CameraPathFlow = 'continuous';
  @Input() transitionMomentum = 0.55;
  @Input() videoExport: VideoExportSettings = { width: 1920, height: 1080, fps: 30, lightEffect: 'none' };
  @Input() textOverlays: TextOverlay[] = [];
  @Input() activeTextOverlayId: string | null = null;
  @Input() editorEnabled = false;
  @Input() brush: DepthBrushSettings = { tool: 'near', size: 80, strength: .25 };
  @Output() historyChange = new EventEmitter<EditorHistoryState>();
  @Output() diagnostics = new EventEmitter<GpuDiagnostics>();
  @Output() cameraPathChange = new EventEmitter<CameraPathState>();
  @Output() cameraSequenceChange = new EventEmitter<CameraMovement[]>();
  @Output() cameraRollChange = new EventEmitter<number>();
  @Output() playbackState = new EventEmitter<boolean>();
  @Output() videoExportState = new EventEmitter<VideoExportState>();
  @Output() textOverlayPositionChange = new EventEmitter<{ id: string; x: number; y: number }>();
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;
  @ViewChild('playbackTimer', { static: true }) playbackTimer!: ElementRef<HTMLSpanElement>;
  private readonly zone = inject(NgZone);
  private readonly api = inject(ApiService);
  private renderer?: THREE.WebGLRenderer; private world = new THREE.Scene(); private comparisonWorld = new THREE.Scene(); private comparisonCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); private overlayWorld = new THREE.Scene(); private overlayCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1); private overlayMeshes: TextOverlayMesh[] = []; private overlayWidth = 0; private overlayHeight = 0; private overlayX = 0; private overlayY = 0; private draggingOverlay?: { item: TextOverlayMesh; offsetX: number; offsetY: number }; private camera?: THREE.PerspectiveCamera; private controls?: OrbitControls;
  private composer?: EffectComposer; private bokehPass?: AuthoredBokehPass; private dofDepthWorld = new THREE.Scene(); private dofDepthMeshes = new Map<string, THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>>();
  private fidelityPreview = false;
  private readonly focusPoint = new THREE.Vector3(); private readonly focusDirection = new THREE.Vector3();
  private meshes = new Map<string, THREE.Mesh<THREE.PlaneGeometry, THREE.Material>>(); private comparison?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; private comparisonOwnsTexture = true;
  private frame = 0; private observer?: ResizeObserver; private previewStarted = 0; private previewPath: ParallaxPath = 'horizontal'; private zoomStarted = 0; private zoomFrom = 5; private zoomTo = 5; private zoomDirection = new THREE.Vector3(0, 0, 1); private driftZoom = false; private driftPhaseX = 0; private driftPhaseY = 0; private driftAmplitudeX = .4; private driftAmplitudeY = .28; private cameraPathStarted = 0; private playbackSequenceStarted = 0; private playbackMovements: CameraMovement[] = []; private playbackMovementIndex = 0; private activeCameraRoll = 0; private comparisonRequest = 0; private sceneLoadGeneration = 0; private loadedSceneKey = '';
  private continuousPositionCurve?: THREE.CatmullRomCurve3; private continuousTargetCurve?: THREE.CatmullRomCurve3; private continuousRollCurve?: THREE.CatmullRomCurve3; private continuousFocusCurve?: THREE.CatmullRomCurve3; private activeFocusDistance?: number; private continuousDuration = 0;
  private editable?: EditableMaps; private drawing = false; private lastPaintUv?: THREE.Vector2;
  private exportRecorder?: MediaRecorder; private exportChunks: Blob[] = []; private exportMimeType = ''; private exportError = ''; private exportRestorePose?: CameraPathPose; private exportPixelRatio = 1; private exportFov = 45; private exportStopFallback?: number; private exportWatchdog?: number;
  cursorVisible = false; cursorTransform = 'translate(-999px,-999px)'; exporting = false; exportFrameWidth = 0; exportFrameHeight = 0; exportPreviewUrl = ''; exportStatus = 'Rendering video'; exportStatusDetail = 'Keep this tab active while the camera path is recorded…';

  ngAfterViewInit(): void { this.setup(); if (this.scene) { this.loadedSceneKey = this.sceneKey(); void this.loadScene(); } }
  ngOnChanges(changes: SimpleChanges): void {
    if (!this.renderer) return;
    if (changes['scene']) { const key = this.sceneKey(); if (key !== this.loadedSceneKey) { this.loadedSceneKey = key; void this.loadScene(); } else { this.applyLayers(); if (changes['comparisonUrl'] && this.comparisonUrl) void this.loadComparison(); } } else if (changes['comparisonUrl'] && this.comparisonUrl) void this.loadComparison(); else this.applyLayers();
    if (changes['differenceGain'] && this.comparison) this.comparison.material.uniforms['gain'].value = this.mode === 'difference' ? this.differenceGain : 1;
    if (changes['editorEnabled'] && this.controls) { this.controls.enabled = !this.editorEnabled; if (!this.editorEnabled) { this.drawing = false; this.cursorVisible = false; } }
    if (changes['videoExport']) { this.updateExportFrame(); this.rebuildTextOverlays(); }
    if (changes['depthOfField']) this.syncDepthOfField();
    if (changes['textOverlays'] || changes['activeTextOverlayId']) this.rebuildTextOverlays();
    if (changes['cameraRoll'] && !this.cameraPathStarted) this.activeCameraRoll = THREE.MathUtils.clamp(this.cameraRoll, -180, 180);
    this.applyMode();
  }
  ngOnDestroy(): void { this.cancelVideoExport(); this.sceneLoadGeneration++; cancelAnimationFrame(this.frame); this.observer?.disconnect(); this.controls?.dispose(); if (this.renderer) { const canvas = this.renderer.domElement; canvas.removeEventListener('pointerdown', this.onPointerDown, true); canvas.removeEventListener('pointermove', this.onPointerMove); canvas.removeEventListener('pointerup', this.onPointerUp); canvas.removeEventListener('pointercancel', this.onPointerUp); canvas.removeEventListener('pointerleave', this.onPointerLeave); } this.disposeComparison(); this.disposeMeshes(); this.disposeTextOverlays(); this.disposePostProcessing(); this.renderer?.dispose(); }
  resetCamera(): void { if (!this.camera || !this.scene || !this.controls) return; this.previewStarted = 0; this.zoomStarted = 0; this.cameraPathStarted = 0; this.activeFocusDistance = undefined; this.driftZoom = false; this.activeCameraRoll = 0; this.camera.position.fromArray(this.scene.camera.position); this.camera.up.set(0, 1, 0); this.controls.target.fromArray(this.scene.camera.target); this.camera.lookAt(this.controls.target); this.camera.updateMatrixWorld(true); this.controls.update(); this.cameraRollChange.emit(0); }
  startParallaxPreview(path: ParallaxPath = 'horizontal'): void { this.resetCamera(); this.previewPath = path; this.previewStarted = performance.now(); }
  startZoom(direction: 'in' | 'out'): void { if (!this.camera || !this.controls) return; this.previewStarted = 0; this.driftZoom = false; this.zoomFrom = this.camera.position.distanceTo(this.controls.target); this.zoomTo = direction === 'in' ? this.controls.minDistance : this.controls.maxDistance; this.zoomDirection.copy(this.camera.position).sub(this.controls.target).normalize(); this.zoomStarted = performance.now(); }
  startDriftZoom(): void { if (!this.camera || !this.controls) return; this.driftPhaseX = Math.random() * Math.PI * 2; this.driftPhaseY = Math.random() * Math.PI * 2; this.driftAmplitudeX = .34 + Math.random() * .28; this.driftAmplitudeY = .22 + Math.random() * .22; this.startZoom('in'); this.driftZoom = true; }
  generateRandomCameraSequence(): void { if (!this.scene) return; this.cameraSequenceChange.emit(createRandomCameraSequence(this.scene, this.videoExport, 5, Math.random, this.separation)); }
  captureCameraPoint(point: 'start' | 'end'): void { if (!this.camera || !this.controls) return; const pose = { position: this.camera.position.toArray() as [number, number, number], target: this.controls.target.toArray() as [number, number, number], roll: this.activeCameraRoll, focusDistance: this.resolveFocusDistance() }; this.cameraPathChange.emit({ ...this.cameraPath, [point]: pose }); }
  goToCameraPoint(point: 'start' | 'end'): void { const pose = this.cameraPath[point]; if (pose) this.goToPose(pose); }
  goToPose(pose: CameraPathPose): void { if (!this.camera || !this.controls) return; this.previewStarted = 0; this.zoomStarted = 0; this.cameraPathStarted = 0; this.driftZoom = false; this.activeCameraRoll = pose.roll ?? 0; this.camera.position.fromArray(pose.position); this.controls.target.fromArray(pose.target); this.camera.lookAt(this.controls.target); this.camera.updateMatrixWorld(true); this.controls.update(); this.applyCameraRoll(); this.cameraRollChange.emit(this.activeCameraRoll); }
  playCameraPath(): void { this.startCameraSequence(false); }
  skipCameraSequence(): void { if (!this.cameraPathStarted || this.exporting) return; const finalPose = this.playbackMovements.at(-1)?.path.end; this.cameraPathStarted = 0; this.activeFocusDistance = undefined; this.playbackSequenceStarted = 0; this.playbackMovementIndex = 0; if (finalPose) this.goToPose(finalPose); this.playbackMovements = []; if (this.controls) this.controls.enabled = !this.editorEnabled; this.setPlaybackMode(false); }
  private startCameraSequence(exporting: boolean): boolean { const movements = this.cameraMovements.filter(movement => movement.path.start && movement.path.end); if (!movements.length || movements.length !== this.cameraMovements.length || !this.camera || !this.controls) return false; this.previewStarted = 0; this.zoomStarted = 0; this.driftZoom = false; this.playbackMovements = movements; this.playbackMovementIndex = 0; const poses = [movements[0].path.start!, ...movements.map(movement => movement.path.end!)]; this.continuousPositionCurve = new THREE.CatmullRomCurve3(poses.map(pose => new THREE.Vector3().fromArray(pose.position)), false, 'centripetal'); this.continuousTargetCurve = new THREE.CatmullRomCurve3(poses.map(pose => new THREE.Vector3().fromArray(pose.target)), false, 'centripetal'); const unwrappedRolls = poses.map(pose => pose.roll ?? 0).reduce<number[]>((rolls, roll) => { const previous = rolls.at(-1); rolls.push(previous === undefined ? roll : previous + THREE.MathUtils.euclideanModulo(roll - previous + 180, 360) - 180); return rolls; }, []); this.continuousRollCurve = new THREE.CatmullRomCurve3(unwrappedRolls.map(roll => new THREE.Vector3(roll, 0, 0)), false, 'centripetal'); this.continuousFocusCurve = poses.every(pose => pose.focusDistance !== undefined) ? new THREE.CatmullRomCurve3(poses.map(pose => new THREE.Vector3(pose.focusDistance!, 0, 0)), false, 'centripetal') : undefined; this.continuousDuration = movements.reduce((total, movement) => total + THREE.MathUtils.clamp(movement.duration, 5, 20), 0) * 1000; this.goToPose(poses[0]); if (!exporting) this.enterFidelityPreview(); this.activeFocusDistance = poses[0].focusDistance; this.controls.enabled = false; this.cameraPathStarted = this.playbackSequenceStarted = performance.now(); this.setPlaybackMode(true, !exporting); return true; }
  exportCameraPath(): void {
    const movements = this.cameraMovements.filter(movement => movement.path.start && movement.path.end);
    if (this.exporting || !movements.length || movements.length !== this.cameraMovements.length || !this.renderer || !this.camera || !this.controls) return;
    const canvas = this.renderer.domElement; const captureStream = canvas.captureStream?.bind(canvas);
    if (!captureStream || typeof MediaRecorder === 'undefined') { this.videoExportState.emit({ exporting: false, error: 'Video export is not supported by this browser.' }); return; }
    const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) { this.videoExportState.emit({ exporting: false, error: 'This browser cannot create the WebM source required for MP4 export.' }); return; }
    this.exporting = true; this.exportStatus = 'Rendering video'; this.exportStatusDetail = 'Keep this tab active while the camera path is recorded…'; this.videoExportState.emit({ exporting: true }); this.exportMimeType = mimeType; this.exportChunks = []; this.exportError = '';
    this.exportRestorePose = { position: this.camera.position.toArray() as [number, number, number], target: this.controls.target.toArray() as [number, number, number], roll: this.activeCameraRoll };
    canvas.style.opacity = '0';
    const viewportBounds = this.host.nativeElement.getBoundingClientRect(); this.updateExportFrame(viewportBounds.width, viewportBounds.height);
    this.exportPixelRatio = this.renderer.getPixelRatio(); this.exportFov = this.camera.fov; this.renderer.setDrawingBufferSize(this.videoExport.width, this.videoExport.height, 1); this.resizePostProcessing(this.videoExport.width, this.videoExport.height, 1); this.rebuildTextOverlays();
    const frameX = (viewportBounds.width - this.exportFrameWidth) / 2; const frameY = (viewportBounds.height - this.exportFrameHeight) / 2; this.camera.fov = this.exportFov; this.camera.aspect = viewportBounds.width / Math.max(1, viewportBounds.height); this.camera.setViewOffset(viewportBounds.width, viewportBounds.height, frameX, frameY, this.exportFrameWidth, this.exportFrameHeight); this.camera.updateProjectionMatrix();
    const firstPose = movements[0].path.start!; this.camera.position.fromArray(firstPose.position); this.controls.target.fromArray(firstPose.target); this.activeCameraRoll = firstPose.roll ?? 0; this.controls.enabled = false; this.controls.update(); this.applyCameraRoll();
    this.setVideoDithering(true); this.renderFrame(0);
    try { this.exportPreviewUrl = canvas.toDataURL('image/jpeg', .82); } catch { this.exportPreviewUrl = ''; }
    try {
      const stream = captureStream(this.videoExport.fps); const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: videoCaptureBitrate(this.videoExport) }); this.exportRecorder = recorder;
      recorder.ondataavailable = event => { if (event.data.size) this.exportChunks.push(event.data); };
      recorder.onerror = () => { this.exportError = 'The browser could not encode the video.'; if (recorder.state !== 'inactive') recorder.stop(); };
      recorder.onstop = () => { for (const track of stream.getTracks()) track.stop(); window.clearTimeout(this.exportStopFallback); window.clearTimeout(this.exportWatchdog); this.exportStopFallback = this.exportWatchdog = undefined; if (!this.exporting) return; const blob = new Blob(this.exportChunks, { type: this.exportMimeType }); if (!blob.size || this.exportError) { this.restoreAfterVideoExport(this.exportError || 'The browser produced an empty video file.'); return; } this.restoreRendererBehindCover(); this.zone.run(() => { this.exportStatus = 'Converting to MP4'; this.exportStatusDetail = 'FFmpeg is encoding H.264 at high quality…'; }); this.api.convertVideo(blob, this.videoExport.lightEffect).subscribe({ next: mp4 => { try { this.downloadVideo(mp4, 'mp4'); this.restoreAfterVideoExport(); } catch { this.restoreAfterVideoExport('The MP4 was converted but could not be downloaded.'); } }, error: (error: Error) => this.restoreAfterVideoExport(error.message) }); };
      recorder.start(250); this.startCameraSequence(true); const totalDuration = movements.reduce((total, movement) => total + THREE.MathUtils.clamp(movement.duration, 5, 20), 0); this.exportWatchdog = window.setTimeout(() => { if (!this.exporting) return; this.exportError = 'Video recording timed out before the browser finalized the file.'; this.finishVideoRecording(); }, totalDuration * 1000 + 5000);
    } catch { this.restoreAfterVideoExport('Video recording could not be started.'); }
  }
  private easeCameraPath(phase: number, easing: CameraPathEasing): number { if (easing === 'linear') return phase; if (easing === 'ease-in') return phase ** 3; if (easing === 'ease-out') return 1 - (1 - phase) ** 3; return phase * phase * phase * (phase * (phase * 6 - 15) + 10); }
  private updateContinuousCamera(now: number): void { if (!this.camera || !this.controls || !this.continuousPositionCurve || !this.continuousTargetCurve || !this.continuousRollCurve) return; const rawPhase = Math.min(1, (now - this.cameraPathStarted) / Math.max(1, this.continuousDuration)); const envelopedPhase = this.easeCameraPath(rawPhase, 'ease-in-out'); const phase = cinematicPathPhase(envelopedPhase, this.playbackMovements.length, this.transitionMomentum); this.continuousPositionCurve.getPoint(phase, this.camera.position); this.continuousTargetCurve.getPoint(phase, this.controls.target); this.activeCameraRoll = this.continuousRollCurve.getPoint(phase).x; if (this.continuousFocusCurve) this.activeFocusDistance = this.continuousFocusCurve.getPoint(phase).x; this.controls.update(); if (rawPhase >= 1) { this.cameraPathStarted = 0; this.activeFocusDistance = undefined; if (!this.exporting) this.controls.enabled = !this.editorEnabled; this.zone.run(() => this.cameraRollChange.emit(this.activeCameraRoll)); this.setPlaybackMode(false); if (this.exporting) requestAnimationFrame(() => this.finishVideoRecording()); } }
  private setPlaybackMode(active: boolean, notify = true): void { if (!active && !this.exporting) { this.exitFidelityPreview(); requestAnimationFrame(() => { if (!this.cameraPathStarted) this.playbackSequenceStarted = 0; }); } if (notify) this.zone.run(() => this.playbackState.emit(active)); }
  private applyCameraRoll(): void { if (this.camera && this.activeCameraRoll) this.camera.rotateZ(THREE.MathUtils.degToRad(this.activeCameraRoll)); }
  private finishVideoRecording(): void { const recorder = this.exportRecorder; if (!recorder || recorder.state === 'inactive') { this.restoreAfterVideoExport(this.exportError || 'The browser stopped recording unexpectedly.'); return; } recorder.stop(); window.clearTimeout(this.exportStopFallback); this.exportStopFallback = window.setTimeout(() => { if (this.exporting) this.restoreAfterVideoExport('The browser did not finalize the video file.'); }, 2000); }
  private restoreRendererBehindCover(): void { if (!this.renderer || !this.camera || !this.controls) return; this.setVideoDithering(false); const bounds = this.host.nativeElement.getBoundingClientRect(); const width = Math.round(bounds.width); const height = Math.round(bounds.height); this.renderer.setPixelRatio(this.exportPixelRatio); this.renderer.setSize(width, height, false); this.resizePostProcessing(width, height, this.exportPixelRatio); this.rebuildTextOverlays(); this.camera.fov = this.exportFov; this.camera.aspect = bounds.width / Math.max(1, bounds.height); this.camera.clearViewOffset(); if (this.exportRestorePose) { this.camera.position.fromArray(this.exportRestorePose.position); this.controls.target.fromArray(this.exportRestorePose.target); this.activeCameraRoll = this.exportRestorePose.roll ?? 0; } this.camera.updateProjectionMatrix(); this.controls.update(); this.applyCameraRoll(); }
  private restoreAfterVideoExport(error?: string): void { if (!this.exporting) return; window.clearTimeout(this.exportStopFallback); window.clearTimeout(this.exportWatchdog); this.exportStopFallback = this.exportWatchdog = undefined; this.setVideoDithering(false); const renderer = this.renderer; const camera = this.camera; const controls = this.controls; this.exportRecorder = undefined; if (renderer) { renderer.domElement.style.opacity = '1'; renderer.setPixelRatio(this.exportPixelRatio); } if (camera && controls) { camera.fov = this.exportFov; if (this.exportRestorePose) { camera.position.fromArray(this.exportRestorePose.position); controls.target.fromArray(this.exportRestorePose.target); this.activeCameraRoll = this.exportRestorePose.roll ?? 0; } controls.enabled = !this.editorEnabled; controls.update(); this.applyCameraRoll(); } this.zone.run(() => { this.exporting = false; this.exportPreviewUrl = ''; this.cameraPathStarted = 0; this.playbackSequenceStarted = 0; this.cameraRollChange.emit(this.activeCameraRoll); this.resize(); this.videoExportState.emit({ exporting: false, error }); }); }
  private downloadVideo(blob: Blob, extension: 'mp4' | 'webm'): void { const name = (this.scene?.name ?? 'camera-path').replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'camera-path'; const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${name}-camera-path.${extension}`; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
  private cancelVideoExport(): void { if (!this.exporting) return; window.clearTimeout(this.exportStopFallback); window.clearTimeout(this.exportWatchdog); this.setVideoDithering(false); this.exporting = false; if (this.exportRecorder?.state !== 'inactive') this.exportRecorder?.stop(); this.videoExportState.emit({ exporting: false }); }
  private setVideoDithering(enabled: boolean): void { for (const mesh of this.meshes.values()) { if (mesh.material instanceof THREE.ShaderMaterial && mesh.material.uniforms['presence']) continue; mesh.material.dithering = enabled; mesh.material.needsUpdate = true; } if (this.comparison) { this.comparison.material.dithering = enabled; this.comparison.material.needsUpdate = true; } }
  undoEdit(): void { if (!this.editable?.undo.length) return; const current = this.captureSnapshot(); const previous = this.editable.undo.pop(); if (!current || !previous) return; this.editable.redo.push(current); this.restoreSnapshot(previous); this.emitHistory(); }
  redoEdit(): void { if (!this.editable?.redo.length) return; const current = this.captureSnapshot(); const next = this.editable.redo.pop(); if (!current || !next) return; this.editable.undo.push(current); this.restoreSnapshot(next); this.emitHistory(); }
  resetEdits(): void { if (!this.editable) return; this.restoreSnapshot(this.editable.original); this.editable.undo = []; this.editable.redo = []; this.emitHistory(); }

  private setup(): void {
    const element = this.host.nativeElement;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.outputColorSpace = THREE.SRGBColorSpace; this.renderer.setClearColor(0x03050a); this.renderer.autoClear = false; element.appendChild(this.renderer.domElement);
    Object.assign(this.renderer.domElement.style, { display: 'block', position: 'absolute', inset: '0', width: '100%', height: '100%' });
    this.camera = new THREE.PerspectiveCamera(45, 1, .1, 100); this.camera.position.set(0, 0, 5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true; this.controls.minDistance = .5; this.controls.maxDistance = 30; this.controls.minPolarAngle = .001; this.controls.maxPolarAngle = Math.PI - .001;
    this.syncDepthOfField();
    this.controls.addEventListener('start', () => { this.previewStarted = 0; this.zoomStarted = 0; this.cameraPathStarted = 0; this.activeFocusDistance = undefined; });
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown, true); this.renderer.domElement.addEventListener('pointermove', this.onPointerMove); this.renderer.domElement.addEventListener('pointerup', this.onPointerUp); this.renderer.domElement.addEventListener('pointercancel', this.onPointerUp); this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(element); requestAnimationFrame(() => this.resize());
    void Promise.all([document.fonts.ready, document.fonts.load('600 16px Cabin'), document.fonts.load('600 16px Bitter'), document.fonts.load('600 16px "DM Sans"')]).then(() => this.rebuildTextOverlays());
    this.zone.runOutsideAngular(() => this.animate());
    this.emitDiagnostics();
  }
  private resize(): void { if (!this.renderer || !this.camera || this.exporting) return; if (this.fidelityPreview) { this.layoutFidelityPreview(); return; } const bounds = this.host.nativeElement.getBoundingClientRect(); const w = Math.round(bounds.width); const h = Math.round(bounds.height); if (!w || !h) return; this.renderer.setSize(w, h, false); this.resizePostProcessing(w, h, this.renderer.getPixelRatio()); this.updateExportFrame(w, h); this.rebuildTextOverlays(); this.camera.aspect = w / h; this.camera.clearViewOffset(); this.camera.filmOffset = 0; this.camera.updateProjectionMatrix(); this.sizeComparison(w / h); this.applyLayers(); }
  private enterFidelityPreview(): void { if (this.fidelityPreview || !this.renderer || !this.camera) return; this.fidelityPreview = true; this.layoutFidelityPreview(); }
  private layoutFidelityPreview(): void {
    if (!this.renderer || !this.camera) return;
    const bounds = this.host.nativeElement.getBoundingClientRect(); this.updateExportFrame(bounds.width, bounds.height);
    const width = Math.max(1, Math.round(this.exportFrameWidth)); const height = Math.max(1, Math.round(this.exportFrameHeight)); const left = Math.round((bounds.width - width) / 2); const top = Math.round((bounds.height - height) / 2);
    Object.assign(this.renderer.domElement.style, { inset: 'auto', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    this.renderer.setSize(width, height, false); this.resizePostProcessing(width, height, this.renderer.getPixelRatio());
    this.camera.aspect = bounds.width / Math.max(1, bounds.height); this.camera.setViewOffset(bounds.width, bounds.height, left, top, width, height); this.camera.updateProjectionMatrix(); this.rebuildTextOverlays(); this.applyLayers();
  }
  private exitFidelityPreview(): void { if (!this.fidelityPreview || !this.renderer) return; this.fidelityPreview = false; Object.assign(this.renderer.domElement.style, { inset: '0', left: '', top: '', width: '100%', height: '100%' }); this.resize(); }
  private syncDepthOfField(): void {
    if (!this.depthOfField.enabled) { this.disposePostProcessing(); return; }
    if (!this.renderer || !this.camera) return;
    if (!this.composer || !this.bokehPass) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.world, this.camera));
      this.bokehPass = new AuthoredBokehPass(this.dofDepthWorld, this.camera, { focus: this.depthOfField.focusDistance, aperture: this.depthOfField.aperture, maxblur: this.depthOfField.maxBlur });
      this.composer.addPass(this.bokehPass);
      this.composer.addPass(new OutputPass());
      const size = this.renderer.getSize(new THREE.Vector2());
      this.resizePostProcessing(size.x, size.y, this.renderer.getPixelRatio());
    }
    const uniforms = this.bokehPass.uniforms as Record<string, THREE.IUniform<number>>;
    uniforms['aperture'].value = this.depthOfField.aperture;
    uniforms['maxblur'].value = this.depthOfField.maxBlur;
    this.updateDepthOfFieldFocus();
  }
  private resolveFocusDistance(): number {
    if (!this.camera) return this.depthOfField.focusDistance;
    if (this.depthOfField.focusMode === 'manual') return this.depthOfField.focusDistance;
    let mesh: THREE.Mesh | undefined;
    if (this.depthOfField.focusMode === 'starless') { const layer = this.scene?.layers.find(candidate => candidate.type === 'nebula'); mesh = layer ? this.meshes.get(layer.id) : undefined; }
    else if (this.depthOfField.focusMode === 'layer' && this.depthOfField.focusLayerId) mesh = this.meshes.get(this.depthOfField.focusLayerId);
    if (mesh) mesh.getWorldPosition(this.focusPoint); else if (this.controls) this.focusPoint.copy(this.controls.target); else return this.depthOfField.focusDistance;
    this.camera.getWorldDirection(this.focusDirection);
    return focusDistanceAlongView(this.camera.position, this.focusDirection, this.focusPoint, this.camera.near);
  }
  private updateDepthOfFieldFocus(): void {
    if (!this.bokehPass || !this.camera) return;
    const focusDistance = this.activeFocusDistance ?? this.resolveFocusDistance();
    (this.bokehPass.uniforms as Record<string, THREE.IUniform<number>>)['focus'].value = focusDistance;
    this.camera.getWorldDirection(this.focusDirection);
    for (const depthMesh of this.dofDepthMeshes.values()) {
      depthMesh.getWorldPosition(this.focusPoint);
      const layerDistance = focusDistanceAlongView(this.camera.position, this.focusDirection, this.focusPoint, this.camera.near);
      depthMesh.material.uniforms['encodedDepth'].value = perspectiveDepthForDistance(layerDistance, this.camera.near, this.camera.far);
    }
  }
  private resizePostProcessing(width: number, height: number, pixelRatio: number): void { if (!this.composer) return; this.composer.setPixelRatio(pixelRatio); this.composer.setSize(width, height); }
  private disposePostProcessing(): void { if (!this.composer) return; for (const pass of this.composer.passes) pass.dispose(); this.composer.dispose(); this.composer = undefined; this.bokehPass = undefined; }
  private updateExportFrame(viewportWidth?: number, viewportHeight?: number): void { const bounds = this.host.nativeElement.getBoundingClientRect(); const hostWidth = viewportWidth ?? bounds.width; const hostHeight = viewportHeight ?? bounds.height; const availableWidth = Math.max(1, hostWidth * .8); const availableHeight = Math.max(1, hostHeight * .8); const aspect = this.videoExport.width / Math.max(1, this.videoExport.height); this.exportFrameWidth = Math.min(availableWidth, availableHeight * aspect); this.exportFrameHeight = this.exportFrameWidth / aspect; }
  private sceneKey(): string { return this.scene?.layers.map(layer => `${layer.id}:${layer.texture_url}:${layer.depth_texture_url ?? ''}:${layer.confidence_texture_url ?? ''}`).join('|') ?? ''; }
  private async loadScene(): Promise<void> {
    const generation = ++this.sceneLoadGeneration; const scene = this.scene; this.comparisonRequest++; this.disposeComparison(); this.disposeMeshes(); if (!scene || !this.camera || !this.controls) return;
    this.camera.fov = scene.camera.fov; this.camera.near = scene.camera.near; this.camera.far = scene.camera.far; this.controls.minDistance = scene.camera.min_distance; this.controls.maxDistance = scene.camera.max_distance;
    const orbit = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(scene.camera.max_orbit_degrees, 0, 180));
    this.controls.minAzimuthAngle = -orbit; this.controls.maxAzimuthAngle = orbit;
    this.controls.minPolarAngle = Math.max(.001, Math.PI / 2 - orbit); this.controls.maxPolarAngle = Math.min(Math.PI - .001, Math.PI / 2 + orbit); this.resetCamera();
    const loader = new THREE.TextureLoader();
    await Promise.all(scene.layers.map(async layer => {
      const [texture, loadedDepth, loadedInverted, loadedConfidence] = await Promise.all([
        loader.loadAsync(layer.texture_url),
        layer.depth_texture_url ? loader.loadAsync(layer.depth_texture_url) : Promise.resolve(null),
        layer.inverted_depth_texture_url ? loader.loadAsync(layer.inverted_depth_texture_url) : Promise.resolve(null),
        layer.confidence_texture_url ? loader.loadAsync(layer.confidence_texture_url) : Promise.resolve(null),
      ]);
      if (generation !== this.sceneLoadGeneration) { for (const candidate of new Set([texture, loadedDepth, loadedInverted, loadedConfidence])) candidate?.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = true;
      let material: THREE.Material;
      if (loadedDepth) {
        const depthTexture = loadedDepth; depthTexture.colorSpace = THREE.NoColorSpace; depthTexture.flipY = true;
        const invertedDepthTexture = loadedInverted ?? depthTexture;
        invertedDepthTexture.colorSpace = THREE.NoColorSpace; invertedDepthTexture.flipY = true;
        const confidenceTexture = loadedConfidence ?? depthTexture;
        confidenceTexture.colorSpace = THREE.NoColorSpace; confidenceTexture.flipY = true;
        const source = texture.image as { width?: number; height?: number };
        material = this.createWarpMaterial(texture, depthTexture, invertedDepthTexture, confidenceTexture, layer.opacity, layer.warp_strength ?? 0, layer.invert_depth ?? false, layer.fine_warp_ratio ?? .25, layer.confidence_amount ?? .7, source.width ?? 1, source.height ?? 1);
        this.editable = this.createEditableMaps(depthTexture.image as CanvasImageSource, confidenceTexture.image as CanvasImageSource, source.width ?? 1, source.height ?? 1);
        const shader = material as THREE.ShaderMaterial;
        shader.uniforms['depthMap'].value = this.editable.depthTexture; shader.uniforms['invertedDepthMap'].value = this.editable.invertedTexture; shader.uniforms['confidenceMap'].value = this.editable.confidenceTexture;
        depthTexture.dispose(); if (invertedDepthTexture !== depthTexture) invertedDepthTexture.dispose(); if (confidenceTexture !== depthTexture && confidenceTexture !== invertedDepthTexture) confidenceTexture.dispose();
      } else {
        material = this.createStarMaterial(texture, layer.opacity);
      }
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material); mesh.renderOrder = layer.order; this.world.add(mesh); this.meshes.set(layer.id, mesh);
      const depthMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.createDofDepthMaterial(texture, layer.type === 'stars', layer.opacity)); depthMesh.renderOrder = layer.order; this.dofDepthWorld.add(depthMesh); this.dofDepthMeshes.set(layer.id, depthMesh);
    }));
    if (generation !== this.sceneLoadGeneration) return;
    if (this.comparisonUrl) await this.loadComparison(); this.applyLayers(); this.applyMode();
    this.emitHistory();
    this.emitDiagnostics();
  }

  private createStarMaterial(texture: THREE.Texture, opacity: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, opacity: { value: opacity }, presence: { value: this.starPresence } },
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D map;
        uniform float opacity;
        uniform float presence;
        varying vec2 vUv;
        #include <dithering_pars_fragment>
        void main() {
          vec4 color = texture2D(map, vUv);
          float enhancedAlpha = 1.0 - pow(max(0.0, 1.0 - color.a), max(0.01, presence));
          gl_FragColor = vec4(color.rgb, enhancedAlpha * opacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <dithering_fragment>
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
  }

  private createDofDepthMaterial(texture: THREE.Texture, alphaMasked: boolean, opacity: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, opacity: { value: opacity }, presence: { value: this.starPresence }, alphaMasked: { value: alphaMasked ? 1 : 0 }, encodedDepth: { value: 1 } },
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D map;
        uniform float opacity;
        uniform float presence;
        uniform float alphaMasked;
        uniform float encodedDepth;
        varying vec2 vUv;
        void main() {
          float alpha = opacity;
          if (alphaMasked > 0.5) {
            float sourceAlpha = texture2D(map, vUv).a;
            alpha *= 1.0 - pow(max(0.0, 1.0 - sourceAlpha), max(0.01, presence));
          }
          if (alpha < 0.002) discard;
          gl_FragColor = vec4(vec3(encodedDepth), 1.0);
        }`,
      depthTest: true, depthWrite: true, side: THREE.DoubleSide,
    });
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
      uniforms: { map: { value: texture }, depthMap: { value: depthTexture }, invertedDepthMap: { value: invertedDepthTexture }, confidenceMap: { value: confidenceTexture }, viewOffset: { value: new THREE.Vector2() }, texelSize: { value: new THREE.Vector2(1 / width, 1 / height) }, strength: { value: strength }, opacity: { value: opacity }, invertDepth: { value: inverted ? 1 : 0 }, fineWarpRatio: { value: fineWarpRatio }, confidenceAmount: { value: confidenceAmount }, lightIntensity: { value: this.lighting.intensity }, relief: { value: this.lighting.relief }, lightDirection: { value: this.lightDirection() } },
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `#include <common>
        uniform sampler2D map;
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
        uniform float lightIntensity;
        uniform float relief;
        uniform vec2 lightDirection;
        varying vec2 vUv;
        #include <dithering_pars_fragment>
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
          vec2 broadOffset = viewOffset * depth * strength * confidence;
          vec2 broadUv = 1.0 - abs(mod(vUv + broadOffset, 2.0) - 1.0);
          vec2 fineUv = 1.0 - abs(mod(vUv + broadOffset * fineWarpRatio, 2.0) - 1.0);
          vec4 broadColor = softSample(broadUv);
          vec4 fineColor = texture2D(map, fineUv) - softSample(fineUv);
          vec4 color = clamp(broadColor + fineColor, 0.0, 1.0);
          float depthLeft = mix(texture2D(depthMap, broadUv - vec2(texelSize.x * 2.0, 0.0)).r, texture2D(invertedDepthMap, broadUv - vec2(texelSize.x * 2.0, 0.0)).r, invertDepth);
          float depthRight = mix(texture2D(depthMap, broadUv + vec2(texelSize.x * 2.0, 0.0)).r, texture2D(invertedDepthMap, broadUv + vec2(texelSize.x * 2.0, 0.0)).r, invertDepth);
          float depthDown = mix(texture2D(depthMap, broadUv - vec2(0.0, texelSize.y * 2.0)).r, texture2D(invertedDepthMap, broadUv - vec2(0.0, texelSize.y * 2.0)).r, invertDepth);
          float depthUp = mix(texture2D(depthMap, broadUv + vec2(0.0, texelSize.y * 2.0)).r, texture2D(invertedDepthMap, broadUv + vec2(0.0, texelSize.y * 2.0)).r, invertDepth);
          vec3 normal = normalize(vec3((depthLeft - depthRight) * relief * 18.0, (depthDown - depthUp) * relief * 18.0, 1.0));
          vec3 light = normalize(vec3(lightDirection, 1.15));
          float diffuse = dot(normal, light);
          vec3 view = normalize(vec3(viewOffset * 0.22, 1.0));
          float rim = pow(1.0 - max(dot(normal, view), 0.0), 2.0);
          float motionReveal = 0.35 + min(length(viewOffset) * 0.45, 0.65);
          float lighting = 1.0 + lightIntensity * motionReveal * ((diffuse - 0.58) * 1.35 + rim * 0.45);
          color.rgb = clamp(color.rgb * lighting, 0.0, 1.0);
          gl_FragColor = vec4(color.rgb, color.a * opacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <dithering_fragment>
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
  }
  private async loadComparison(): Promise<void> {
    const url = this.comparisonUrl; if (!url) return; const request = ++this.comparisonRequest;
    const editedTexture = this.editedComparisonTexture();
    const texture = editedTexture ?? await new THREE.TextureLoader().loadAsync(url);
    const ownsTexture = !editedTexture;
    if (request !== this.comparisonRequest) { if (ownsTexture) texture.dispose(); return; }
    this.disposeComparison(); this.comparisonOwnsTexture = ownsTexture; if (ownsTexture) { texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = true; }
    const material = new THREE.ShaderMaterial({ uniforms: { map: { value: texture }, gain: { value: this.mode === 'difference' ? this.differenceGain : 1 } }, vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`, fragmentShader: `#include <common>
      uniform sampler2D map;
      uniform float gain; varying vec2 vUv;
      #include <dithering_pars_fragment>
      void main(){
        vec4 color=texture2D(map,vUv);
        gl_FragColor=vec4(clamp(color.rgb*gain,0.0,1.0),1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <dithering_fragment>
      }`, depthTest: false, depthWrite: false });
    this.comparison = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material); this.comparison.position.z = -.5; this.comparisonWorld.add(this.comparison); const bounds = this.host.nativeElement.getBoundingClientRect(); this.sizeComparison(bounds.width / Math.max(1, bounds.height)); this.applyMode();
  }
  private editedComparisonTexture(): THREE.Texture | undefined {
    if (!this.editable) return undefined;
    if (this.mode === 'confidence') return this.editable.confidenceTexture;
    if (this.mode !== 'depth') return undefined;
    const inverted = this.scene?.layers.find(layer => layer.type === 'nebula')?.invert_depth ?? false;
    return inverted ? this.editable.invertedTexture : this.editable.depthTexture;
  }
  private sizeComparison(viewportAspect: number): void { if (!this.comparison || !this.scene) return; const imageAspect = this.scene.source.width / this.scene.source.height; if (viewportAspect > imageAspect) this.comparison.scale.set(imageAspect / viewportAspect, 1, 1); else this.comparison.scale.set(1, viewportAspect / imageAspect, 1); }
  private disposeComparison(): void { if (!this.comparison) return; this.comparisonWorld.remove(this.comparison); this.comparison.geometry.dispose(); if (this.comparisonOwnsTexture) (this.comparison.material.uniforms['map'].value as THREE.Texture).dispose(); this.comparison.material.dispose(); this.comparison = undefined; this.comparisonOwnsTexture = true; }
  private sizePlane(mesh: THREE.Mesh, depth: number, position: {x:number;y:number;z:number}, scale: {x:number;y:number;z:number}): void {
    if (!this.scene || !this.camera) return; const distance = this.scene.camera.position[2] - depth; const height = 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)); const width = height * this.scene.source.width / this.scene.source.height;
    mesh.position.set(position.x, position.y, depth); mesh.scale.set(width * scale.x, height * scale.y, scale.z);
  }
  private lightDirection(): THREE.Vector2 { const radians = THREE.MathUtils.degToRad(this.lighting.direction); return new THREE.Vector2(Math.cos(radians), Math.sin(radians)); }
  private applyLayers(): void { if (!this.scene) return; const anchor = this.scene.layers.find(layer => layer.type === 'nebula'); const anchorDepth = anchor?.depth ?? 0; const anchorPositionZ = anchor?.transform.position.z ?? 0; for (const layer of this.scene.layers) { const mesh = this.meshes.get(layer.id); if (!mesh) continue; const visible = this.mode === '3d' && layer.visible && (!this.soloLayerId || this.soloLayerId === layer.id); mesh.visible = visible; if (mesh.material instanceof THREE.ShaderMaterial) { const uniforms = mesh.material.uniforms; uniforms['opacity'].value = layer.opacity; if (uniforms['presence']) uniforms['presence'].value = this.starPresence; if (uniforms['strength']) { uniforms['strength'].value = layer.warp_strength ?? 0; uniforms['invertDepth'].value = layer.invert_depth ? 1 : 0; uniforms['fineWarpRatio'].value = layer.fine_warp_ratio ?? .25; uniforms['confidenceAmount'].value = layer.confidence_amount ?? .7; uniforms['lightIntensity'].value = this.lighting.intensity; uniforms['relief'].value = this.lighting.relief; uniforms['lightDirection'].value.copy(this.lightDirection()); } } const effectiveDepth = effectiveLayerDepth(layer, anchorDepth, anchorPositionZ, this.separation); this.sizePlane(mesh, effectiveDepth, layer.transform.position, layer.transform.scale); const depthMesh = this.dofDepthMeshes.get(layer.id); if (depthMesh) { depthMesh.visible = visible; depthMesh.material.uniforms['opacity'].value = layer.opacity; depthMesh.material.uniforms['presence'].value = this.starPresence; this.sizePlane(depthMesh, effectiveDepth, layer.transform.position, layer.transform.scale); } } }
  private applyMode(): void { if (!this.scene) return; for (const layer of this.scene.layers) { const visible = this.mode === '3d' && layer.visible && (!this.soloLayerId || this.soloLayerId === layer.id); const mesh = this.meshes.get(layer.id); if (mesh) mesh.visible = visible; const depthMesh = this.dofDepthMeshes.get(layer.id); if (depthMesh) depthMesh.visible = visible; } }
  private onPointerDown = (event: PointerEvent): void => {
    if (!this.editorEnabled && !this.exporting && this.scene && this.mode === '3d' && event.button === 0) { const point = this.overlayPointer(event); const item = this.overlayMeshes.find(candidate => candidate.overlay.id === this.activeTextOverlayId); if (point && item?.mesh.visible && Math.abs(point.x - item.mesh.position.x) <= item.mesh.geometry.parameters.width / 2 && Math.abs(point.y - item.baseY) <= item.mesh.geometry.parameters.height / 2) { event.preventDefault(); event.stopImmediatePropagation(); this.draggingOverlay = { item, offsetX: point.x - item.mesh.position.x, offsetY: point.y - item.baseY }; if (this.controls) this.controls.enabled = false; this.renderer?.domElement.setPointerCapture(event.pointerId); return; } }
    if (!this.editorEnabled || event.button !== 0) return; const uv = this.pointerUv(event); if (!uv || !this.editable) return;
    event.preventDefault(); this.renderer?.domElement.setPointerCapture(event.pointerId); const before = this.captureSnapshot(); if (before) { this.editable.undo.push(before); if (this.editable.undo.length > 12) this.editable.undo.shift(); this.editable.redo = []; }
    this.drawing = true; this.lastPaintUv = uv; this.paintAt(uv); this.emitHistory();
  };
  private onPointerMove = (event: PointerEvent): void => {
    if (this.draggingOverlay) { const point = this.overlayPointer(event); if (!point) return; const item = this.draggingOverlay.item; const halfWidth = item.mesh.geometry.parameters.width / 2; const halfHeight = item.mesh.geometry.parameters.height / 2; const marginX = this.overlayWidth * .02; const marginY = this.overlayHeight * .02; const centerX = THREE.MathUtils.clamp(point.x - this.draggingOverlay.offsetX, this.overlayX + marginX + halfWidth, this.overlayX + this.overlayWidth - marginX - halfWidth); const centerY = THREE.MathUtils.clamp(point.y - this.draggingOverlay.offsetY, this.overlayY + marginY + halfHeight, this.overlayY + this.overlayHeight - marginY - halfHeight); item.mesh.position.x = centerX; item.mesh.position.y = item.baseY = centerY; item.selection?.position.set(centerX, centerY, 0); const x = (centerX - this.overlayX) / this.overlayWidth; const y = (centerY - this.overlayY) / this.overlayHeight; this.zone.run(() => this.textOverlayPositionChange.emit({ id: item.overlay.id, x, y })); return; }
    if (!this.editorEnabled) { const point = this.overlayPointer(event); const item = this.overlayMeshes.find(candidate => candidate.overlay.id === this.activeTextOverlayId); const overCaption = !!this.scene && !!point && !!item?.mesh.visible && Math.abs(point.x - item.mesh.position.x) <= item.mesh.geometry.parameters.width / 2 && Math.abs(point.y - item.baseY) <= item.mesh.geometry.parameters.height / 2; if (this.renderer) this.renderer.domElement.style.cursor = overCaption ? 'move' : ''; return; } const bounds = this.host.nativeElement.getBoundingClientRect(); this.cursorTransform = `translate(${event.clientX - bounds.left - this.brush.size / 2}px,${event.clientY - bounds.top - this.brush.size / 2}px)`; this.cursorVisible = true;
    if (!this.drawing) return; const uv = this.pointerUv(event); if (!uv || !this.lastPaintUv) return;
    const distance = uv.distanceTo(this.lastPaintUv); const spacing = Math.max(.002, this.brush.size / Math.max(bounds.width, bounds.height) * .18); const steps = Math.max(1, Math.ceil(distance / spacing)); const from = this.lastPaintUv.clone(); for (let step = 1; step <= steps; step++) this.paintAt(from.clone().lerp(uv, step / steps)); this.lastPaintUv = uv;
  };
  private onPointerUp = (event: PointerEvent): void => { if (this.draggingOverlay) { this.draggingOverlay = undefined; if (this.controls) this.controls.enabled = !this.editorEnabled; if (this.renderer?.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId); return; } if (!this.drawing) return; this.drawing = false; this.lastPaintUv = undefined; if (this.renderer?.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId); };
  private onPointerLeave = (): void => { if (!this.drawing) this.cursorVisible = false; if (this.renderer && !this.draggingOverlay) this.renderer.domElement.style.cursor = ''; };
  private pointerUv(event: PointerEvent): THREE.Vector2 | null {
    if (!this.camera || !this.scene) return null; const canvas = this.renderer?.domElement; if (!canvas) return null; const bounds = canvas.getBoundingClientRect(); const pointer = new THREE.Vector2((event.clientX - bounds.left) / bounds.width * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1); const nebula = this.scene.layers.find(layer => layer.type === 'nebula'); const mesh = nebula ? this.meshes.get(nebula.id) : undefined; if (!mesh) return null; const raycaster = new THREE.Raycaster(); raycaster.setFromCamera(pointer, this.camera); const hit = raycaster.intersectObject(mesh, false)[0]; return hit?.uv?.clone() ?? null;
  }
  private overlayPointer(event: PointerEvent): THREE.Vector2 | null { if (!this.renderer) return null; const bounds = this.renderer.domElement.getBoundingClientRect(); const size = this.renderer.getDrawingBufferSize(new THREE.Vector2()); return new THREE.Vector2((event.clientX - bounds.left) * size.x / Math.max(1, bounds.width), (bounds.bottom - event.clientY) * size.y / Math.max(1, bounds.height)); }
  private paintAt(uv: THREE.Vector2): void {
    const maps = this.editable; if (!maps) return; const target = this.brush.tool === 'protect' ? maps.confidenceContext : maps.depthContext; const image = this.brush.tool === 'protect' ? maps.confidenceImage : maps.depthImage; const source = image.data; const radiusX = this.brushRadiusInMapPixels(maps); const radiusY = radiusX; const centerX = uv.x * maps.width; const centerY = (1 - uv.y) * maps.height; const minX = Math.max(0, Math.floor(centerX - radiusX)); const maxX = Math.min(maps.width - 1, Math.ceil(centerX + radiusX)); const minY = Math.max(0, Math.floor(centerY - radiusY)); const maxY = Math.min(maps.height - 1, Math.ceil(centerY + radiusY)); const inverted = this.scene?.layers.find(layer => layer.type === 'nebula')?.invert_depth ?? false; const gaussianEdge = Math.exp(-2);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) { const distance = Math.hypot((x - centerX) / radiusX, (y - centerY) / radiusY); if (distance >= 1) continue; const falloff = (Math.exp(-2 * distance * distance) - gaussianEdge) / (1 - gaussianEdge); const weight = falloff * this.brush.strength; const index = (y * maps.width + x) * 4; let value = image.data[index];
      if (this.brush.tool === 'near' || this.brush.tool === 'far') { const activeDirection = this.brush.tool === 'near' ? 1 : -1; value += activeDirection * (inverted ? -1 : 1) * 20 * weight; }
      else if (this.brush.tool === 'protect') value += (0 - value) * Math.min(1, weight * .16);
      else { let total = 0; let count = 0; for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) { const sx = Math.min(maps.width - 1, Math.max(0, x + ox)); const sy = Math.min(maps.height - 1, Math.max(0, y + oy)); total += source[(sy * maps.width + sx) * 4]; count++; } value += (total / count - value) * Math.min(1, weight * .32); }
      value = Math.max(0, Math.min(255, value)); image.data[index] = image.data[index + 1] = image.data[index + 2] = value; image.data[index + 3] = 255;
    }
    target.putImageData(image, 0, 0, minX, minY, maxX - minX + 1, maxY - minY + 1); if (this.brush.tool !== 'protect') this.refreshInvertedMap(minX, minY, maxX, maxY); else maps.confidenceTexture.needsUpdate = true;
  }
  private brushRadiusInMapPixels(maps: EditableMaps): number {
    const bounds = this.host.nativeElement.getBoundingClientRect(); const nebula = this.scene?.layers.find(layer => layer.type === 'nebula'); const mesh = nebula ? this.meshes.get(nebula.id) : undefined;
    if (!mesh || !this.camera) return Math.max(1, this.brush.size * .5 * Math.sqrt(maps.width / bounds.width * (maps.height / bounds.height)));
    mesh.updateWorldMatrix(true, false); const project = (x: number, y: number) => new THREE.Vector3(x, y, 0).applyMatrix4(mesh.matrixWorld).project(this.camera!);
    const left = project(-.5, 0); const right = project(.5, 0); const bottom = project(0, -.5); const top = project(0, .5);
    const projectedWidth = Math.max(1, Math.hypot(left.x - right.x, left.y - right.y) * bounds.width * .5); const projectedHeight = Math.max(1, Math.hypot(bottom.x - top.x, bottom.y - top.y) * bounds.height * .5);
    return Math.max(1, this.brush.size * .5 * Math.sqrt(maps.width / projectedWidth * (maps.height / projectedHeight)));
  }
  private refreshInvertedMap(minX = 0, minY = 0, maxX?: number, maxY?: number): void { const maps = this.editable; if (!maps) return; const endX = maxX ?? maps.width - 1; const endY = maxY ?? maps.height - 1; for (let y = minY; y <= endY; y++) for (let x = minX; x <= endX; x++) { const index = (y * maps.width + x) * 4; const value = 255 - maps.depthImage.data[index]; maps.invertedImage.data[index] = maps.invertedImage.data[index + 1] = maps.invertedImage.data[index + 2] = value; maps.invertedImage.data[index + 3] = 255; } maps.invertedContext.putImageData(maps.invertedImage, 0, 0, minX, minY, endX - minX + 1, endY - minY + 1); maps.depthTexture.needsUpdate = true; maps.invertedTexture.needsUpdate = true; }
  private captureSnapshot(): EditSnapshot | undefined { const maps = this.editable; if (!maps) return undefined; return { depth: new Uint8ClampedArray(maps.depthImage.data), confidence: new Uint8ClampedArray(maps.confidenceImage.data) }; }
  private restoreSnapshot(snapshot: EditSnapshot): void { const maps = this.editable; if (!maps) return; maps.depthImage.data.set(snapshot.depth); maps.confidenceImage.data.set(snapshot.confidence); maps.depthContext.putImageData(maps.depthImage, 0, 0); maps.confidenceContext.putImageData(maps.confidenceImage, 0, 0); maps.confidenceTexture.needsUpdate = true; this.refreshInvertedMap(); }
  private emitHistory(): void { this.historyChange.emit({ canUndo: !!this.editable?.undo.length, canRedo: !!this.editable?.redo.length, modified: !!this.editable?.undo.length }); }
  private emitDiagnostics(): void { if (!this.renderer) return; const gl = this.renderer.getContext(); const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number; const parameters = this.scene?.processing.parameters; const previewWidth = Number(parameters?.['previewWidth'] ?? this.scene?.source.width ?? 0); const previewHeight = Number(parameters?.['previewHeight'] ?? this.scene?.source.height ?? 0); this.diagnostics.emit({ maxTextureSize, renderer: gl.getParameter(gl.RENDERER) as string, previewWidth, previewHeight, sourceTooLarge: !!this.scene && Math.max(this.scene.source.width, this.scene.source.height) > maxTextureSize }); }
  private rebuildTextOverlays(): void {
    if (!this.renderer) return;
    this.disposeTextOverlays();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const width = Math.max(1, Math.round(size.x)); const height = Math.max(1, Math.round(size.y));
    const hostBounds = this.host.nativeElement.getBoundingClientRect();
    const viewportWidth = this.exporting || this.fidelityPreview ? width : this.exportFrameWidth * width / Math.max(1, hostBounds.width);
    const viewportHeight = this.exporting || this.fidelityPreview ? height : this.exportFrameHeight * height / Math.max(1, hostBounds.height);
    const viewportX = (width - viewportWidth) / 2; const viewportY = (height - viewportHeight) / 2;
    this.overlayWidth = viewportWidth; this.overlayHeight = viewportHeight; this.overlayX = viewportX; this.overlayY = viewportY;
    this.overlayCamera.left = 0; this.overlayCamera.right = width; this.overlayCamera.top = height; this.overlayCamera.bottom = 0; this.overlayCamera.updateProjectionMatrix();
    for (const overlay of this.textOverlays) {
      if (!overlay.text.trim()) continue;
      const alignment: CanvasTextAlign = overlay.alignment;
      const fontSize = Math.max(12, Math.round(viewportHeight * THREE.MathUtils.clamp(overlay.fontSize, 1.5, 12) / 100));
      const fontFamily = overlay.fontFamily === 'Bitter' || overlay.fontFamily === 'DM Sans' ? overlay.fontFamily : 'Cabin';
      const font = `${THREE.MathUtils.clamp(overlay.fontWeight, 400, 700)} ${fontSize}px "${fontFamily}", system-ui, sans-serif`;
      const letterSpacing = `${fontSize * THREE.MathUtils.clamp(overlay.letterSpacing, -.1, .2)}px`;
      const padding = Math.max(8, Math.round(fontSize * .42)); const lineHeight = Math.round(fontSize * THREE.MathUtils.clamp(overlay.lineHeight, .8, 2)); const maxWidth = viewportWidth * .72;
      const measureCanvas = document.createElement('canvas'); const measure = measureCanvas.getContext('2d'); if (!measure) continue;
      measure.font = font; measure.letterSpacing = letterSpacing;
      const lines: string[] = [];
      for (const paragraph of overlay.text.split('\n')) {
        const words = paragraph.split(/\s+/).filter(Boolean); let line = '';
        if (!words.length) { lines.push(''); continue; }
        for (const word of words) { const candidate = line ? `${line} ${word}` : word; if (line && measure.measureText(candidate).width > maxWidth) { lines.push(line); line = word; } else line = candidate; }
        lines.push(line);
      }
      const textWidth = Math.max(fontSize, ...lines.map(line => measure.measureText(line).width));
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(Math.min(maxWidth, textWidth) + padding * 2); canvas.height = Math.ceil(lines.length * lineHeight + padding * 2);
      const context = canvas.getContext('2d'); if (!context) continue;
      context.font = font; context.letterSpacing = letterSpacing; context.textBaseline = 'middle'; context.textAlign = alignment;
      if (overlay.background) { context.fillStyle = 'rgba(3,5,10,.55)'; const radius = padding * .55; context.beginPath(); context.roundRect(0, 0, canvas.width, canvas.height, radius); context.fill(); }
      if (overlay.shadow) { context.shadowColor = 'rgba(0,0,0,.8)'; context.shadowBlur = Math.max(3, fontSize * .16); context.shadowOffsetY = Math.max(1, fontSize * .05); }
      context.fillStyle = overlay.color || '#ffffff'; const textX = alignment === 'left' ? padding : alignment === 'right' ? canvas.width - padding : canvas.width / 2;
      lines.forEach((line, index) => context.fillText(line, textX, padding + lineHeight * (index + .5), canvas.width - padding * 2));
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false; texture.premultiplyAlpha = true;
      const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(canvas.width, canvas.height), material); const marginX = viewportWidth * .02; const marginY = viewportHeight * .02; const halfWidth = canvas.width / 2; const halfHeight = canvas.height / 2;
      mesh.position.x = THREE.MathUtils.clamp(viewportX + THREE.MathUtils.clamp(overlay.x, 0, 1) * viewportWidth, viewportX + marginX + halfWidth, viewportX + viewportWidth - marginX - halfWidth);
      mesh.position.y = THREE.MathUtils.clamp(viewportY + THREE.MathUtils.clamp(overlay.y, 0, 1) * viewportHeight, viewportY + marginY + halfHeight, viewportY + viewportHeight - marginY - halfHeight);
      mesh.renderOrder = 1000; this.overlayWorld.add(mesh); let selection: THREE.LineLoop | undefined;
      if (overlay.id === this.activeTextOverlayId) { const border = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-halfWidth, -halfHeight, 0), new THREE.Vector3(halfWidth, -halfHeight, 0), new THREE.Vector3(halfWidth, halfHeight, 0), new THREE.Vector3(-halfWidth, halfHeight, 0)]); selection = new THREE.LineLoop(border, new THREE.LineBasicMaterial({ color: 0xafa1ff, transparent: true, opacity: .75, depthTest: false, depthWrite: false })); selection.position.copy(mesh.position); selection.renderOrder = 1001; this.overlayWorld.add(selection); }
      this.overlayMeshes.push({ overlay, mesh, selection, baseY: mesh.position.y });
    }
  }
  private disposeTextOverlays(): void { this.draggingOverlay = undefined; for (const item of this.overlayMeshes) { this.overlayWorld.remove(item.mesh); item.mesh.geometry.dispose(); item.mesh.material.map?.dispose(); item.mesh.material.dispose(); if (item.selection) { this.overlayWorld.remove(item.selection); item.selection.geometry.dispose(); (item.selection.material as THREE.Material).dispose(); } } this.overlayMeshes = []; }
  private updateTextOverlays(elapsed: number | null): void { for (const item of this.overlayMeshes) { const timelineOpacity = elapsed === null ? (item.overlay.enabled ? 1 : 0) : textOverlayOpacity(item.overlay, elapsed); const opacity = timelineOpacity * THREE.MathUtils.clamp(item.overlay.opacity, 0, 1); item.mesh.material.opacity = opacity; const local = elapsed === null ? 1 : Math.max(0, elapsed - item.overlay.start); const progress = Math.min(1, local / Math.max(.2, item.overlay.fadeIn || .8)); item.mesh.position.y = item.baseY + (item.overlay.motion ? (progress - 1) * this.overlayHeight * .012 : 0); item.mesh.visible = opacity > 0; if (item.selection) { item.selection.position.set(item.mesh.position.x, item.mesh.position.y, 0); item.selection.visible = elapsed === null && !this.exporting && item.mesh.visible; } } }
  private updatePlaybackTimer(elapsed: number | null): void { const timer = this.playbackTimer.nativeElement; const visible = elapsed !== null && !this.exporting; timer.classList.toggle('visible', visible); if (visible) timer.textContent = `${elapsed.toFixed(1)}s`; }
  private renderFrame(elapsed: number | null): void { if (!this.renderer || !this.camera) return; this.updateTextOverlays(elapsed); if (this.mode === '3d' && this.depthOfField.enabled && this.composer) { this.updateDepthOfFieldFocus(); this.composer.render(); } else { this.renderer.clear(); if (this.mode === '3d') this.renderer.render(this.world, this.camera); else this.renderer.render(this.comparisonWorld, this.comparisonCamera); } if (this.scene && this.mode === '3d' && this.overlayMeshes.length) { this.renderer.clearDepth(); this.renderer.render(this.overlayWorld, this.overlayCamera); } }
  private animate = (): void => {
    this.frame = requestAnimationFrame(this.animate);
    if (this.previewStarted && this.camera && this.controls) { const elapsed = performance.now() - this.previewStarted; const duration = 4200; if (elapsed < duration) { const phase = elapsed / duration; const envelope = Math.sin(phase * Math.PI); const angle = phase * Math.PI * 2; const horizontalRange = this.previewPath === 'orbit' ? .72 : .82; const verticalRange = this.previewPath === 'orbit' ? .48 : .58; const x = this.previewPath === 'vertical' ? 0 : Math.sin(angle) * horizontalRange * envelope; const y = this.previewPath === 'horizontal' ? 0 : (this.previewPath === 'orbit' ? Math.cos(angle) : Math.sin(angle)) * verticalRange * envelope; this.camera.position.set(this.controls.target.x + x, this.controls.target.y + y, this.scene?.camera.position[2] ?? 5); this.controls.update(); } else { this.previewStarted = 0; this.resetCamera(); } }
    if (this.zoomStarted && this.camera && this.controls) { const phase = Math.min(1, (performance.now() - this.zoomStarted) / 5000); const eased = phase * phase * phase * (phase * (phase * 6 - 15) + 10); const distance = THREE.MathUtils.lerp(this.zoomFrom, this.zoomTo, eased); this.camera.position.copy(this.controls.target).addScaledVector(this.zoomDirection, distance); if (this.driftZoom) { const envelope = Math.sin(Math.PI * phase) ** 2; const driftX = Math.sin(phase * Math.PI * 2 + this.driftPhaseX) * this.driftAmplitudeX * envelope; const driftY = Math.sin(phase * Math.PI * 3 + this.driftPhaseY) * this.driftAmplitudeY * envelope; this.camera.position.x += driftX; this.camera.position.y += driftY; } this.controls.update(); if (phase >= 1) { this.zoomStarted = 0; this.driftZoom = false; } }
    if (this.cameraPathStarted && this.cameraPathFlow !== 'per-movement') this.updateContinuousCamera(performance.now());
    if (this.cameraPathStarted && this.cameraPathFlow === 'per-movement' && this.camera && this.controls) { const movement = this.playbackMovements[this.playbackMovementIndex]; const start = movement?.path.start; const end = movement?.path.end; if (!movement || !start || !end) { this.cameraPathStarted = 0; this.activeFocusDistance = undefined; this.controls.enabled = !this.editorEnabled; this.setPlaybackMode(false); } else { const duration = THREE.MathUtils.clamp(movement.duration, 5, 20) * 1000; const phase = Math.min(1, (performance.now() - this.cameraPathStarted) / duration); const eased = this.easeCameraPath(phase, movement.easing); const startPosition = new THREE.Vector3().fromArray(start.position); const endPosition = new THREE.Vector3().fromArray(end.position); const startTarget = new THREE.Vector3().fromArray(start.target); const endTarget = new THREE.Vector3().fromArray(end.target); this.camera.position.lerpVectors(startPosition, endPosition, eased); this.controls.target.lerpVectors(startTarget, endTarget, eased); this.activeCameraRoll = THREE.MathUtils.lerp(start.roll ?? 0, end.roll ?? 0, eased); this.activeFocusDistance = interpolateFocusDistance(start.focusDistance, end.focusDistance, eased); this.controls.update(); if (phase >= 1) { if (this.playbackMovementIndex < this.playbackMovements.length - 1) { this.playbackMovementIndex++; this.cameraPathStarted = performance.now(); } else { this.cameraPathStarted = 0; this.activeFocusDistance = undefined; if (!this.exporting) this.controls.enabled = !this.editorEnabled; this.zone.run(() => this.cameraRollChange.emit(this.activeCameraRoll)); this.setPlaybackMode(false); if (this.exporting) requestAnimationFrame(() => this.finishVideoRecording()); } } } }
    if (this.controls && !this.previewStarted) this.controls.update();
    this.applyCameraRoll();
    if (this.camera && this.controls && this.scene) { const origin = this.scene.camera.position; const target = this.scene.camera.target; const relativeX = (this.camera.position.x - this.controls.target.x) - (origin[0] - target[0]); const relativeY = (this.camera.position.y - this.controls.target.y) - (origin[1] - target[1]); for (const mesh of this.meshes.values()) if (mesh.material instanceof THREE.ShaderMaterial && mesh.material.uniforms['viewOffset']) mesh.material.uniforms['viewOffset'].value.set(relativeX, relativeY); }
    const playbackElapsed = this.playbackSequenceStarted ? (performance.now() - this.playbackSequenceStarted) / 1000 : null;
    this.updatePlaybackTimer(playbackElapsed);
    this.renderFrame(playbackElapsed);
  };
  private disposeMeshes(): void { for (const depthMesh of this.dofDepthMeshes.values()) { this.dofDepthWorld.remove(depthMesh); depthMesh.geometry.dispose(); depthMesh.material.dispose(); } this.dofDepthMeshes.clear(); for (const mesh of this.meshes.values()) { this.world.remove(mesh); mesh.geometry.dispose(); if (mesh.material instanceof THREE.ShaderMaterial) { (mesh.material.uniforms['map'].value as THREE.Texture).dispose(); const depthMap = mesh.material.uniforms['depthMap']?.value as THREE.Texture | undefined; const invertedDepthMap = mesh.material.uniforms['invertedDepthMap']?.value as THREE.Texture | undefined; const confidenceMap = mesh.material.uniforms['confidenceMap']?.value as THREE.Texture | undefined; depthMap?.dispose(); if (invertedDepthMap && invertedDepthMap !== depthMap) invertedDepthMap.dispose(); if (confidenceMap && confidenceMap !== depthMap && confidenceMap !== invertedDepthMap) confidenceMap.dispose(); } mesh.material.dispose(); } this.meshes.clear(); this.editable = undefined; this.emitHistory(); }
}
