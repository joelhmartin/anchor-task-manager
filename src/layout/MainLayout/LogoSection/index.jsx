import { Link as RouterLink } from 'react-router-dom';

import Link from '@mui/material/Link';

import Logo from 'ui-component/Logo';

export default function LogoSection() {
  return (
    <Link
      component={RouterLink}
      to="/"
      aria-label="theme-logo"
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}
    >
      <Logo />
    </Link>
  );
}
