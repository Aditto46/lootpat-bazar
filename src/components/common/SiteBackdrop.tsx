export function SiteBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="aurora aurora-teal -left-40 top-[-14rem] h-[34rem] w-[34rem]" />
      <div className="aurora aurora-violet right-[-14rem] top-[16rem] h-[40rem] w-[40rem]" />
      <div className="aurora aurora-gold bottom-[-18rem] left-[26%] h-[30rem] w-[30rem]" />
      <div className="hero-grid absolute inset-0 opacity-60" />
      <div className="grain absolute inset-0" />
    </div>
  );
}
