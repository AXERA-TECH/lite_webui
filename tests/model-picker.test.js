import { describe, it, expect, beforeEach } from 'vitest';
import { ModelPicker } from '../src/components/model-picker.js';
import { store } from '../src/store.js';

function mountPicker() {
  const picker = new ModelPicker();
  document.body.appendChild(picker.render());
  return picker;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('ModelPicker', () => {
  it('shows only models fetched for the current baseUrl', () => {
    store.saveSettings({ baseUrl: 'http://a.local' });
    store.saveAvailableModels('http://a.local', ['model-a', 'model-b']);
    store.saveAvailableModels('http://b.local', ['model-c']);

    const picker = mountPicker();

    expect(picker._getAllModels()).toEqual(['model-a', 'model-b']);
  });

  it('loads the selected model only from the current baseUrl', () => {
    store.saveSettings({ baseUrl: 'http://a.local' });
    store.saveAvailableModels('http://a.local', ['model-a']);
    store.setCurrentModel('http://a.local', 'model-a');
    store.saveAvailableModels('http://b.local', ['model-b']);
    store.setCurrentModel('http://b.local', 'model-b');

    const picker = mountPicker();

    expect(picker.getModel()).toBe('model-a');
  });

  it('clears an invalid selected model when the fetched list changes', () => {
    store.saveSettings({ baseUrl: 'http://a.local' });
    store.saveAvailableModels('http://a.local', ['model-a']);
    store.setCurrentModel('http://a.local', 'model-a');

    const picker = mountPicker();
    picker.setModels(['model-b']);

    expect(picker.getModel()).toBe('');
    expect(store.getCurrentModel('http://a.local')).toBe('');
  });

  it('default current model is empty when nothing is selected', () => {
    const picker = mountPicker();
    expect(picker.getModel()).toBe('');
  });
});

describe('ModelPicker – multi-endpoint', () => {
  it('shows models from all configured endpoints', () => {
    store.saveEndpoints([
      { id: 'ep1', name: 'Local', baseUrl: 'http://local', apiKey: '' },
      { id: 'ep2', name: 'Remote', baseUrl: 'http://remote', apiKey: '' },
    ]);
    store.saveAvailableModels('http://local', ['model-a']);
    store.saveAvailableModels('http://remote', ['model-b']);

    const picker = mountPicker();
    const models = picker._getAllModels();
    expect(models).toContain('model-a');
    expect(models).toContain('model-b');
  });

  it('selecting a model from endpoint 2 updates the active endpoint', () => {
    store.saveEndpoints([
      { id: 'ep1', name: 'Local', baseUrl: 'http://local', apiKey: '' },
      { id: 'ep2', name: 'Remote', baseUrl: 'http://remote', apiKey: '' },
    ]);
    store.saveAvailableModels('http://local', ['model-a']);
    store.saveAvailableModels('http://remote', ['model-b']);
    store.setActiveEndpointId('ep1');

    const picker = mountPicker();
    picker.setModel('model-b', 'ep2');

    expect(store.getActiveEndpointId()).toBe('ep2');
  });

  it('single endpoint (via legacy settings) shows all models without grouping', () => {
    store.saveSettings({ baseUrl: 'http://a.local' });
    store.saveAvailableModels('http://a.local', ['model-x', 'model-y']);

    const picker = mountPicker();
    expect(picker._getAllModels()).toEqual(['model-x', 'model-y']);
  });
});
