interface Props {
  avatar: string | null;
  name: string;
  size?: number;
}

export default function Avatar({ avatar, name, size = 40 }: Props) {
  const style = { width: size, height: size, fontSize: size * 0.55 };
  if (avatar && avatar.startsWith('data:image/')) {
    return <img className="avatar" src={avatar} alt={name} style={style} />;
  }
  return (
    <span className="avatar avatar-emoji" style={style} role="img" aria-label={name}>
      {avatar || name.charAt(0).toUpperCase()}
    </span>
  );
}
