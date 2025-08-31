import {Component} from '@angular/core';
import {RouterOutlet} from '@angular/router';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  title = 'ui';
  constructor() {
    console.warn('Base websocket :' + environment.socket +
      ' production? ' +  environment.production);
  }
}
