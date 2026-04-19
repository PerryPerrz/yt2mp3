import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { YoutubeService } from './services/youtube.service';
import { VideoInfo } from './models/video-info.model';

type Status = 'idle' | 'fetching' | 'ready' | 'downloading' | 'done' | 'error';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  url = '';
  status: Status = 'idle';
  errorMessage = '';
  videoInfo: VideoInfo | null = null;

  constructor(
    private ytService: YoutubeService,
    private cdr: ChangeDetectorRef,
  ) {}

  get isValidUrl(): boolean {
    return this.ytService.isValidYoutubeUrl(this.url);
  }

  get formattedDuration(): string {
    return this.videoInfo
      ? this.ytService.formatDuration(this.videoInfo.duration)
      : '';
  }

  get formattedViews(): string {
    if (!this.videoInfo?.viewCount) return '';
    return parseInt(this.videoInfo.viewCount, 10).toLocaleString('fr-FR');
  }

  fetchInfo(): void {
    if (!this.isValidUrl) {
      this.status = 'error';
      this.errorMessage = 'Veuillez entrer une URL YouTube valide.';
      this.cdr.detectChanges();
      return;
    }

    this.status = 'fetching';
    this.videoInfo = null;
    this.errorMessage = '';
    this.cdr.detectChanges();

    this.ytService.getVideoInfo(this.url).subscribe({
      next: (info) => {
        this.videoInfo = info;
        this.status = 'ready';
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.status = 'error';
        this.errorMessage = err.message || "Erreur lors de l'analyse.";
        this.cdr.detectChanges();
      },
    });
  }

  downloadMp3(): void {
    if (!this.videoInfo) return;

    this.status = 'downloading';
    this.cdr.detectChanges();

    this.ytService.downloadMp3(this.url).subscribe({
      next: (blob) => {
        const a = document.createElement('a');
        const objectUrl = URL.createObjectURL(blob);
        const filename = `${this.videoInfo!.title.replace(/[^\w\s-]/gi, '')}.mp3`;

        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();

        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);

        this.status = 'done';
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.status = 'error';
        this.errorMessage = err.message || 'Erreur lors du téléchargement.';
        this.cdr.detectChanges();
      },
    });
  }

  reset(): void {
    this.url = '';
    this.status = 'idle';
    this.videoInfo = null;
    this.errorMessage = '';
    this.cdr.detectChanges();
  }

  async pasteFromClipboard(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      this.url = text;
      this.cdr.detectChanges();
    } catch {}
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && this.isValidUrl) {
      this.fetchInfo();
    }
  }
}
