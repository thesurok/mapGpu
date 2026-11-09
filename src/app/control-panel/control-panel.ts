import { Component, inject } from '@angular/core';
import { FigurineCollection, type FigurineSite } from '../figurine/figurine-collection';
import { FigurineCallout } from '../figurine-callout/figurine-callout';
import { FigurineIcon } from '../figurine-icon/figurine-icon';

@Component({
  selector: 'app-control-panel',
  imports: [FigurineIcon],
  templateUrl: './control-panel.html',
  styleUrl: './control-panel.css',
})
export class ControlPanel {
  readonly collection = inject(FigurineCollection);
  private readonly callout = inject(FigurineCallout);

  constructor() {
    void this.collection.load();
  }

  onFigurinePress(figurine: FigurineSite, event: MouseEvent): void {
    if (!this.collection.collected().has(figurine.id)) {
      return;
    }
    const open = this.callout.current();
    if (open?.pinned && open.id === figurine.id) {
      this.callout.dismiss();
      return;
    }
    this.callout.pin({
      id: figurine.id,
      title: figurine.title,
      description: figurine.description,
      x: event.clientX,
      y: event.clientY,
    });
  }
}
