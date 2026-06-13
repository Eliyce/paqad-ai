import { create } from 'zustand';
import type { Graph, GraphEdge, GraphNode, NodeDetail } from './types';
import type { OverlayKind } from './overlay';
import type { ThemeMode } from './theme';
import { getThemeMode, setThemeMode } from './theme';

export interface LayerVisibility {
  modules: boolean;
  files: boolean;
  chunks: boolean;
  symbols: boolean;
  contains: boolean;
  imports: boolean;
  similar: boolean;
}

export interface SearchState {
  query: string;
  matches: string[]; // node ids
  index: number;
}

export interface SimilarityState {
  threshold: number;
  loading: boolean;
  edges: GraphEdge[];
  capped: boolean;
  error: string | null;
}

export interface AppState {
  graph: Graph | null;
  loading: boolean;
  error: string | null;
  selectedNode: GraphNode | null;
  selectedDetail: NodeDetail | null;
  detailLoading: boolean;
  layers: LayerVisibility;
  theme: ThemeMode;
  search: SearchState;
  similarity: SimilarityState;
  overlay: OverlayKind;
  setOverlay: (o: OverlayKind) => void;
  setGraph: (g: Graph | null) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  selectNode: (n: GraphNode | null) => void;
  setDetail: (d: NodeDetail | null) => void;
  setDetailLoading: (b: boolean) => void;
  toggleLayer: (k: keyof LayerVisibility) => void;
  setLayers: (layers: LayerVisibility) => void;
  setTheme: (m: ThemeMode) => void;
  setSearchQuery: (q: string) => void;
  setSearchMatches: (matches: string[]) => void;
  setSearchIndex: (i: number) => void;
  setSimilarityThreshold: (t: number) => void;
  setSimilarityLoading: (b: boolean) => void;
  setSimilarityResult: (edges: GraphEdge[], capped: boolean) => void;
  setSimilarityError: (e: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  graph: null,
  loading: true,
  error: null,
  selectedNode: null,
  selectedDetail: null,
  detailLoading: false,
  search: { query: '', matches: [], index: 0 },
  similarity: { threshold: 0.75, loading: false, edges: [], capped: false, error: null },
  // North Star default (issue #162): lead with the health-coloured map of
  // named areas. Files, chunks, and symbols arrive via semantic zoom; the raw
  // overlay picker lives under Advanced.
  overlay: 'health',
  setOverlay: (overlay) => set({ overlay }),
  layers: {
    modules: true,
    files: false,
    chunks: false,
    symbols: false,
    contains: false,
    imports: false,
    similar: false,
  },
  theme: typeof window !== 'undefined' ? getThemeMode() : 'auto',
  setGraph: (g) => set({ graph: g }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  selectNode: (selectedNode) =>
    set({ selectedNode, selectedDetail: null, detailLoading: Boolean(selectedNode) }),
  setDetail: (selectedDetail) => set({ selectedDetail, detailLoading: false }),
  setDetailLoading: (detailLoading) => set({ detailLoading }),
  toggleLayer: (k) =>
    set((s) => ({
      layers: { ...s.layers, [k]: !s.layers[k] },
    })),
  setLayers: (layers) => set({ layers }),
  setTheme: (m) => {
    setThemeMode(m);
    set({ theme: m });
  },
  setSearchQuery: (q) => set((s) => ({ search: { ...s.search, query: q } })),
  setSearchMatches: (matches) =>
    set((s) => ({ search: { ...s.search, matches, index: matches.length > 0 ? 0 : 0 } })),
  setSearchIndex: (index) => set((s) => ({ search: { ...s.search, index } })),
  setSimilarityThreshold: (t) => set((s) => ({ similarity: { ...s.similarity, threshold: t } })),
  setSimilarityLoading: (loading) => set((s) => ({ similarity: { ...s.similarity, loading } })),
  setSimilarityResult: (edges, capped) =>
    set((s) => ({ similarity: { ...s.similarity, edges, capped, loading: false, error: null } })),
  setSimilarityError: (error) =>
    set((s) => ({ similarity: { ...s.similarity, error, loading: false } })),
}));
