import { it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import App from './App.vue';

it('renders the app name', () => {
  expect(mount(App).text()).toContain('Recipe Library');
});
