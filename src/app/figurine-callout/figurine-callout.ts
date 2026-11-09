import {
  Component,
  ElementRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';

export interface FigurineCalloutRequest {
  id: string;
  title: string;
  description: string;
  /** Viewport coordinates of the pointer. */
  x: number;
  y: number;
}

interface FigurineCalloutModel extends FigurineCalloutRequest {
  pinned: boolean;
}

@Injectable({ providedIn: 'root' })
export class FigurineCallout {
  readonly current = signal<FigurineCalloutModel | null>(null);
  private card: HTMLElement | null = null;
  private pointerOverCard = false;
  /** Close button sets this so a stale hover point cannot reopen the card. */
  private hoverBlocked = false;

  attachCard(element: HTMLElement | null): void {
    this.card = element;
  }

  setPointerOverCard(over: boolean): void {
    this.pointerOverCard = over;
  }

  hover(next: FigurineCalloutRequest): void {
    if (this.hoverBlocked || !hasCalloutText(next)) {
      return;
    }
    const open = this.current();
    if (open?.pinned || open?.id === next.id) {
      return;
    }
    this.current.set({ ...next, pinned: false });
  }

  pin(next: FigurineCalloutRequest): void {
    if (!hasCalloutText(next)) {
      return;
    }
    this.hoverBlocked = false;
    this.current.set({ ...next, pinned: true });
  }

  /** Drop an unpinned card. A pinned card stays until `close` or `dismiss`. */
  hideHover(): void {
    if (this.current()?.pinned || this.pointerOverCard) {
      return;
    }
    this.current.set(null);
  }

  close(): void {
    this.pointerOverCard = false;
    this.current.set(null);
  }

  dismiss(): void {
    this.close();
    this.hoverBlocked = true;
  }

  resumeHover(): void {
    this.hoverBlocked = false;
  }

  covers(clientX: number, clientY: number): boolean {
    const card = this.card;
    if (!card) {
      return false;
    }
    const rect = card.getBoundingClientRect();
    const pad = 24;
    return (
      clientX >= rect.left - pad &&
      clientX <= rect.right + pad &&
      clientY >= rect.top - pad &&
      clientY <= rect.bottom + pad
    );
  }
}

export function hasCalloutText(text: { title: string; description: string }): boolean {
  return text.title.trim().length > 0 || text.description.trim().length > 0;
}

/** Keep the card on screen, preferring the side that has room from the pointer. */
export function placeFigurineCallout(
  anchorX: number,
  anchorY: number,
  viewportWidth: number,
  viewportHeight: number,
): { left: number; top: number } {
  const margin = 12;
  const offset = 16;
  const width = Math.min(340, Math.max(0, viewportWidth - margin * 2));
  const height = Math.min(viewportHeight * 0.5, 420);
  let left = anchorX + offset;
  let top = anchorY + offset;
  if (left + width > viewportWidth - margin) {
    left = anchorX - offset - width;
  }
  if (top + height > viewportHeight - margin) {
    top = anchorY - offset - height;
  }
  const maxLeft = Math.max(margin, viewportWidth - margin - width);
  const maxTop = Math.max(margin, viewportHeight - margin - height);
  return {
    left: Math.min(Math.max(left, margin), maxLeft),
    top: Math.min(Math.max(top, margin), maxTop),
  };
}

@Component({
  selector: 'app-figurine-callout',
  templateUrl: './figurine-callout.html',
  styleUrl: './figurine-callout.css',
})
export class FigurineCalloutView {
  readonly callout = inject(FigurineCallout);
  private readonly cardEl = viewChild<ElementRef<HTMLElement>>('cardEl');

  readonly placement = computed(() => {
    const open = this.callout.current();
    if (!open || typeof window === 'undefined') {
      return null;
    }
    const position = placeFigurineCallout(open.x, open.y, window.innerWidth, window.innerHeight);
    return { ...position, title: open.title, description: open.description };
  });

  constructor() {
    effect(() => {
      this.callout.attachCard(this.cardEl()?.nativeElement ?? null);
    });
  }

  onCardLeave(): void {
    this.callout.setPointerOverCard(false);
    this.callout.hideHover();
  }
}
