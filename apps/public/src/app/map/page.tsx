import { MapPage } from '@fsm/ui/components/map-page';
import { getSelections } from '@/app/actions/selections';
import { getCheckTimeline, getAddressesAtTime, getAddressesForMap } from '@/app/actions/map-timeline';

export default function PublicMapPage() {
  return (
    <MapPage
      getSelections={getSelections}
      getAddressesForMap={getAddressesForMap}
      getAddressesAtTime={getAddressesAtTime}
      getCheckTimeline={getCheckTimeline}
      omniReferralUrl={process.env.NEXT_PUBLIC_OMNI_REFERRAL_URL}
      cartoApiKey={process.env.NEXT_PUBLIC_CARTO_API_KEY}
    />
  );
}
