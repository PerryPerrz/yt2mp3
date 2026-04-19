// frontend/src/app/services/youtube.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { VideoInfo } from '../models/video-info.model';

@Injectable({
  providedIn: 'root',
})
export class YoutubeService {
  private apiUrl: string;

  constructor(private http: HttpClient) {
    if (window.location.hostname === 'localhost') {
      this.apiUrl = 'http://localhost:3000/api';
    } else {
      this.apiUrl = '/api';
    }
  }

  getVideoInfo(url: string): Observable<VideoInfo> {
    return this.http.post<VideoInfo>(`${this.apiUrl}/info`, { url });
  }

  downloadMp3(url: string): Observable<Blob> {
    return this.http.post(`${this.apiUrl}/download`, { url }, {
      responseType: 'blob',
    });
  }

  isValidYoutubeUrl(url: string): boolean {
    const pattern =
      /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]{11}/;
    return pattern.test(url);
  }

  formatDuration(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
}
