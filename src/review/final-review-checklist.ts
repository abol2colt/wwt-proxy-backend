export interface ReviewChecklistItem {
  title: string;
  done: boolean;
}

export const finalReviewChecklist: ReviewChecklistItem[] = [
  { title: 'Check changed files', done: false },
  { title: 'Review merge conflicts', done: false },
  { title: 'Validate final build', done: false },
];
