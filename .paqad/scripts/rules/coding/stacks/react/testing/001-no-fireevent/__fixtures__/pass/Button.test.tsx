import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
it('clicks', async () => {
  await userEvent.click(screen.getByRole('button'));
});
