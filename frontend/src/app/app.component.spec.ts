import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => { localStorage.clear(); await TestBed.configureTestingModule({ imports: [AppComponent], providers: [provideHttpClient()] }).compileComponents(); });
  it('starts with the import workflow', () => {
    const fixture = TestBed.createComponent(AppComponent); fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Build scene');
    expect(fixture.nativeElement.textContent).toContain('Paralastro 0.5');
    expect(fixture.nativeElement.textContent).toContain('Bring your astrophotography to life through motion.');
    expect(fixture.nativeElement.textContent).toContain('Depth map · optional');
    expect(fixture.nativeElement.textContent).toContain('Reveal the space inside your image');
  });
  it('restores saved viewer preferences', () => {
    const first = TestBed.createComponent(AppComponent).componentInstance;
    first.updatePreference('separation', 2.2);
    first.updatePreference('starPresence', 1.6);
    first.updateWarp(0.035);
    first.updateLighting('intensity', .11);
    first.updateDepthOfField('enabled', true);
    first.updateDepthOfFieldMode('manual');
    first.updateDepthOfField('focusDistance', 7.4);
    first.updateDepthOfField('aperture', .004);
    first.updateDepthOfField('maxBlur', .012);
    first.updateCameraRoll(-28);
    first.updatePathDuration(16);
    first.updatePathEasing('ease-out');
    first.updatePathFlow('continuous');
    first.updateTransitionMomentum(.7);
    first.updateVideoExport('width', 2560);
    first.updateVideoExport('fps', 60);
    first.updateVideoLightEffect('soft-reflections');
    first.addTextOverlay();
    first.updateTextOverlay({ text: 'Horsehead Nebula', fadeIn: 1.2 });
    const restored = TestBed.createComponent(AppComponent).componentInstance;
    expect(restored.separation).toBe(2.2);
    expect(restored.starPresence).toBe(1.6);
    expect(restored.starSettings.warpStrength).toBe(0.035);
    expect(restored.lighting.intensity).toBe(.11);
    expect(restored.depthOfField).toEqual({ enabled: true, focusMode: 'manual', focusDistance: 7.4, aperture: .004, maxBlur: .012 });
    expect(restored.cameraRoll).toBe(-28);
    expect(restored.cameraPathDuration).toBe(16);
    expect(restored.cameraPathEasing).toBe('ease-out');
    expect(restored.cameraPathFlow).toBe('continuous');
    expect(restored.transitionMomentum).toBe(.7);
    expect(restored.videoExport.width).toBe(2560);
    expect(restored.videoExport.fps).toBe(60);
    expect(restored.videoExport.lightEffect).toBe('soft-reflections');
    expect(restored.textOverlays[0].text).toBe('Horsehead Nebula');
    expect(restored.textOverlays[0].fadeIn).toBe(1.2);
  });
  it('bounds cinematic depth of field settings', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    component.updateDepthOfField('focusDistance', 100);
    component.updateDepthOfField('aperture', -1);
    component.updateDepthOfField('maxBlur', .5);
    expect(component.depthOfField).toEqual({ enabled: false, focusMode: 'starless', focusDistance: 30, aperture: 0, maxBlur: .02 });
  });
  it('inherits the previous caption settings without copying its text', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    component.addTextOverlay();
    component.updateTextOverlay({ text: 'Original caption', fontFamily: 'Bitter', letterSpacing: .08, lineHeight: 1.65, opacity: .55, x: .2, y: .7 });
    const previous = component.activeTextOverlay!;
    component.addTextOverlay();
    const added = component.activeTextOverlay!;
    expect(added.text).toBe('Caption');
    expect(added.id).not.toBe(previous.id);
    expect({ ...added, id: previous.id, text: previous.text }).toEqual(previous);
  });
  it('chains a new camera movement from the previous endpoint', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    const end = { position: [1, 2, 3] as [number, number, number], target: [0, 0, 0] as [number, number, number], roll: 24 };
    component.updateCameraPath({ start: { position: [0, 0, 5], target: [0, 0, 0], roll: 0 }, end });
    component.updatePathDuration(12);
    component.updatePathEasing('ease-out');
    component.addMovement();
    expect(component.cameraMovements.length).toBe(2);
    expect(component.cameraPath.start).toEqual(end);
    expect(component.cameraPath.end).toBeUndefined();
    expect(component.cameraPathDuration).toBe(12);
    expect(component.cameraPathEasing).toBe('ease-out');
  });
  it('limits the camera timeline to five movements', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    for (let index = 0; index < 8; index++) component.addMovement();
    expect(component.cameraMovements.length).toBe(5);
  });
  it('centers the camera when depth editing begins', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    const resetCamera = jasmine.createSpy('resetCamera');
    component.viewer = { resetCamera } as never;
    component.setEditor(true);
    expect(component.editorOpen).toBeTrue();
    expect(component.mode).toBe('3d');
    expect(resetCamera).toHaveBeenCalled();
  });
  it('links the active movement start to the previous endpoint', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    const previousEnd = { position: [2, 1, 4] as [number, number, number], target: [0, 1, 0] as [number, number, number], roll: -16 };
    component.updateCameraPath({ start: { position: [0, 0, 5], target: [0, 0, 0] }, end: previousEnd });
    component.addMovement();
    component.updateCameraPath({ ...component.cameraPath, start: { position: [9, 9, 9], target: [1, 1, 1], roll: 30 } });
    component.linkActiveMovementToPrevious();
    expect(component.cameraPath.start).toEqual(previousEnd);
    expect(component.cameraPath.start).not.toBe(previousEnd);
    expect(component.cameraRoll).toBe(-16);
  });
});
