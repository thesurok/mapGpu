import { Injectable, signal } from '@angular/core';

export interface FigurineSite {
  id: string;
  longitude: number;
  latitude: number;
  title: string;
  description: string;
}

interface FigurineDataFile {
  [id: string]: {
    longitude: number;
    latitude: number;
    title?: string;
    description?: string;
  };
}

/** Which figurines the player has stabilized, shared by the map and the control panel. */
@Injectable({ providedIn: 'root' })
export class FigurineCollection {
  private readonly collectedIds = signal<ReadonlySet<string>>(new Set());
  private loadPromise: Promise<void> | null = null;

  readonly figurines = signal<readonly FigurineSite[]>([]);
  readonly collected = this.collectedIds.asReadonly();

  load(): Promise<void> {
    this.loadPromise ??= this.fetchFigurines();
    return this.loadPromise;
  }

  collect(id: string): void {
    this.collectedIds.update((current) => {
      if (current.has(id)) {
        return current;
      }
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  private async fetchFigurines(): Promise<void> {
    try {
      // Relative to <base href> so GitHub Pages project sites resolve under /mapGpu/.
      const response = await fetch('data/figurines-data.json');
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as FigurineDataFile;
      this.figurines.set(
        Object.entries(data).map(([id, site]) => ({
          id,
          longitude: site.longitude,
          latitude: site.latitude,
          title: site.title ?? '',
          description: site.description ?? '',
        })),
      );
    } catch {
      this.figurines.set([]);
    }
  }
}
