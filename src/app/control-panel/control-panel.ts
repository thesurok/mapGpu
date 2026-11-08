import { Component, inject } from '@angular/core';
import { FigurineCollection } from '../figurine/figurine-collection';
import { FigurineIcon } from '../figurine-icon/figurine-icon';

@Component({
  selector: 'app-control-panel',
  imports: [FigurineIcon],
  templateUrl: './control-panel.html',
  styleUrl: './control-panel.css',
})
export class ControlPanel {
  readonly collection = inject(FigurineCollection);

  constructor() {
    void this.collection.load();
  }
}
