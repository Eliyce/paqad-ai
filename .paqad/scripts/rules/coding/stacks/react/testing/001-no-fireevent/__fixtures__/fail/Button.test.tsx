import { render, fireEvent } from '@testing-library/react';
it('clicks', () => {
  fireEvent.click(document.querySelector('button'));
});
