import { createRoot } from 'react-dom/client';
export function mountWidget(el) {
  createRoot(el).render(<div>widget</div>);
}
