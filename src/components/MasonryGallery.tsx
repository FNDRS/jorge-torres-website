import Masonry from 'react-masonry-css';

type Props = {
  images: string[];
};

const breakpointColumns = {
  default: 4,
  1280: 4,
  1024: 3,
  768: 2,
  640: 2,
};

export default function MasonryGallery({ images }: Props) {
  return (
    <Masonry
      breakpointCols={breakpointColumns}
      className="masonry-grid"
      columnClassName="masonry-column"
    >
      {images.map((src, i) => (
        <div key={i} className="mb-3">
          <img src={src} alt="" loading="lazy" className="w-full rounded-lg object-cover" />
        </div>
      ))}
    </Masonry>
  );
}
