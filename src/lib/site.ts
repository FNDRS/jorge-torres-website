export type NavItem = {
  label: string;
  href: string;
};

export const site = {
  name: 'Jorge Torres',
  role: 'Software Engineer',
  location: 'Mexico',
  nav: [
    { label: 'About', href: '#about' },
    { label: 'Work', href: '#work' },
    { label: 'Projects', href: '#projects' },
    { label: 'Contact', href: '#contact' },
  ] satisfies NavItem[],
  social: {
    github: 'https://github.com/',
    linkedin: 'https://www.linkedin.com/',
    email: 'mailto:hello@example.com',
  },
};
