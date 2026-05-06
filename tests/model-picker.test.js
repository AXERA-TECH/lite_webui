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
