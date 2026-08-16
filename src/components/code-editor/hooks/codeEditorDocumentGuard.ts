type DocumentLoadToken = {
  identity: string;
  generation: number;
};

type DocumentSaveToken = {
  identity: string;
  generation: number;
  contentRevision: number;
};

/**
 * Tracks the selected document and its edit/save generations so asynchronous
 * responses can update only the document and buffer revision that created them.
 */
export function createCodeEditorDocumentGuard() {
  let activeIdentity = '';
  let loadGeneration = 0;
  let saveGeneration = 0;
  let contentRevision = 0;

  return {
    beginDocumentLoad(identity: string): DocumentLoadToken {
      activeIdentity = identity;
      loadGeneration += 1;
      saveGeneration += 1;
      contentRevision = 0;
      return { identity, generation: loadGeneration };
    },

    canCommitLoad(token: DocumentLoadToken): boolean {
      return token.identity === activeIdentity && token.generation === loadGeneration;
    },

    noteContentChange(identity: string): void {
      if (identity === activeIdentity) contentRevision += 1;
    },

    beginDocumentSave(identity: string): DocumentSaveToken {
      saveGeneration += 1;
      return {
        identity,
        generation: saveGeneration,
        contentRevision,
      };
    },

    isLatestSave(token: DocumentSaveToken): boolean {
      return token.identity === activeIdentity && token.generation === saveGeneration;
    },

    canCommitSave(token: DocumentSaveToken): boolean {
      return token.identity === activeIdentity
        && token.generation === saveGeneration
        && token.contentRevision === contentRevision;
    },

    isActiveDocument(identity: string): boolean {
      return identity === activeIdentity;
    },
  };
}
