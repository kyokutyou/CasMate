export interface UpdateNotice {
  id: string;
  source: 'settings' | 'obsControl' | 'smartphone';
  message: string;
}
