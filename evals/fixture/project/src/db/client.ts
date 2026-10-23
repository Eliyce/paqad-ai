export interface User {
  id: string;
  name: string | null;
}

export async function findUser(id: string): Promise<User | null> {
  return id === 'u1' ? { id, name: 'Ada' } : null;
}
