import './style.css';
import { store } from './store.js';
import { App } from './components/app.js';

// Model Manager and similar launchers can preselect a runtime without putting
// credentials in the URL. Only the public API base and model ID are accepted.
store.applyLaunchParameters();

const app = new App(document.getElementById('app'));
app.init();
