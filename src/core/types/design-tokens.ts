export interface DesignTokenLeaf {
  $value: unknown;
  $type: string;
  $description?: string;
}

export interface DesignTokenGroup {
  [key: string]: DesignTokenNode;
}

export type DesignTokenNode = DesignTokenLeaf | DesignTokenGroup;

export type DesignTokensDocument = DesignTokenGroup;

export interface DesignTokenDocArtifact {
  path: string;
  content: string;
}

export interface ThemeExportArtifact {
  path: string;
  content: string;
}
