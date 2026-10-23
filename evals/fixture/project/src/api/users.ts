export interface UserDto {
  id: string;
  name: string;
}

export function toUserDto(user: { id: string; name: string | null }): UserDto {
  return { id: user.id, name: user.name };
}
