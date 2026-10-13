import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';
import { ProjectResponse } from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  createProject(starless: File, stars: File, depthMap: File | null, settings: { layerCount: number; distribution: string; sensitivity: number; backgroundMode: string; warpStrength: number; depthSmoothing: number; absorptionStrength: number; invertDepth: boolean; fineWarpRatio: number; confidenceAmount: number }): Observable<ProjectResponse> {
    const form = new FormData();
    form.append('starless', starless); form.append('stars', stars);
    if (depthMap) form.append('depth_map', depthMap);
    form.append('star_layer_count', String(settings.layerCount));
    form.append('star_distribution', settings.distribution);
    form.append('star_sensitivity', String(settings.sensitivity));
    form.append('star_background_mode', settings.backgroundMode);
    form.append('nebula_warp_strength', String(settings.warpStrength));
    form.append('nebula_depth_smoothing', String(settings.depthSmoothing));
    form.append('nebula_absorption_strength', String(settings.absorptionStrength));
    form.append('nebula_depth_invert', String(settings.invertDepth));
    form.append('nebula_fine_warp_ratio', String(settings.fineWarpRatio));
    form.append('nebula_confidence_amount', String(settings.confidenceAmount));
    return this.http.post<ProjectResponse>('/api/v1/projects', form).pipe(catchError((error: HttpErrorResponse) => {
      const detail = error.error?.detail;
      return throwError(() => new Error(typeof detail === 'object' ? detail.message : 'Processing failed. Confirm the backend is running and try again.'));
    }));
  }

  deleteProject(projectId: string): void { this.http.delete(`/api/v1/projects/${projectId}`).subscribe(); }

  startVideoRender(fps: number, lightEffect: string): Observable<{ renderId: string }> { const form = new FormData(); form.append('fps', String(fps)); form.append('light_effect', lightEffect); return this.http.post<{ renderId: string }>('/api/v1/video-renders', form); }
  appendVideoFrame(renderId: string, frame: Blob): Observable<void> { const form = new FormData(); form.append('frame', frame, 'frame.jpg'); return this.http.post<void>(`/api/v1/video-renders/${renderId}/frames`, form); }
  finishVideoRender(renderId: string, expectedFrames: number): Observable<Blob> { const form = new FormData(); form.append('expected_frames', String(expectedFrames)); return this.http.post(`/api/v1/video-renders/${renderId}/finish`, form, { responseType: 'blob' }); }
  cancelVideoRender(renderId: string): Observable<void> { return this.http.delete<void>(`/api/v1/video-renders/${renderId}`); }

  convertVideo(video: Blob, lightEffect: string = 'none', inputFps?: number): Observable<Blob> {
    const extension = video.type === 'application/x-mjpeg' ? 'mjpeg' : 'webm';
    const form = new FormData(); form.append('video', video, `camera-path.${extension}`); form.append('light_effect', lightEffect);
    if (inputFps) form.append('input_fps', String(inputFps));
    return this.http.post('/api/v1/videos/convert', form, { responseType: 'blob' }).pipe(catchError(() => throwError(() => new Error('MP4 conversion failed. Check the backend terminal for the FFmpeg error.'))));
  }
}
