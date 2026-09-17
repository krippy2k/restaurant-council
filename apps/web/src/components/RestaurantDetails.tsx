import type { ReactNode } from "react";
import {
  HERO_PHOTO_MAX_WIDTH,
  restaurantPhotoUrl,
  selectPrimaryPhoto,
  type RestaurantView
} from "../restaurant-display";
import {
  derivePublicRejectionReasons,
  formatReasonValue,
  presentRejectionReasons,
  type RejectionReasonView
} from "../rejection-reasons";
import { DietaryCompatibility } from "./DietaryCompatibility";
import { EvaluationBars } from "./EvaluationBars";
import { HoursStatus } from "./HoursStatus";
import { RestaurantContact } from "./RestaurantContact";
import { RestaurantExtraDetails } from "./RestaurantExtraDetails";
import { RestaurantPhoto } from "./RestaurantPhoto";
import { RestaurantPrice } from "./RestaurantPrice";
import { RestaurantRating } from "./RestaurantRating";

export interface RecommendationView {
  candidate: RestaurantView;
  councilScore: number;
  evaluations: Array<{
    participantId: string;
    score: number;
    label: string;
    rejected: boolean;
    privateConflict?: boolean;
  }>;
  explanations: string[];
  rejected: boolean;
  rejectionSummary?: string;
  rejectionReasons?: RejectionReasonView[];
}

export function RestaurantDetails({
  recommendation,
  names,
  constraints = [],
  children
}: {
  recommendation: RecommendationView;
  names: Map<string, string>;
  constraints?: Array<{
    participantId: string;
    type: string;
    value: unknown;
    priority: string;
    visibility?: string;
  }>;
  children?: ReactNode;
}) {
  const restaurant = recommendation.candidate;
  const photo = selectPrimaryPhoto(restaurant.photos);
  const rejectionReasons = presentRejectionReasons(
    recommendation.rejectionReasons?.length
      ? recommendation.rejectionReasons
      : derivePublicRejectionReasons({
          restaurant,
          constraints,
          evaluations: recommendation.evaluations
        }),
    restaurant
  );

  return (
    <article className={`rec-card resto-details ${recommendation.rejected ? "rejected" : ""}`}>
      <RestaurantPhoto
        src={
          photo
            ? restaurantPhotoUrl(restaurant.id, photo.providerPhotoId, HERO_PHOTO_MAX_WIDTH)
            : undefined
        }
        name={restaurant.name}
        className="photo-hero"
        width={HERO_PHOTO_MAX_WIDTH}
        sizes="(max-width: 800px) 100vw, 640px"
      />
      <div className="resto-card-body">
        <div className="kicker">
          {recommendation.rejected ? "Set aside" : `Council score ${recommendation.councilScore}%`}
        </div>
        <h2>{restaurant.name}</h2>
        <p className="resto-meta">
          <RestaurantRating rating={restaurant.rating} reviewCount={restaurant.reviewCount} />
          <RestaurantPrice priceLevel={restaurant.priceLevel} priceRange={restaurant.priceRange} />
        </p>
        <HoursStatus
          assessment={restaurant.hoursAssessment}
          timeZone={restaurant.openingHours?.timeZone}
        />
        <DietaryCompatibility restaurant={restaurant} />
        <p className="muted">
          {restaurant.cuisines.join(", ") || "Restaurant"}
          {restaurant.address ? ` · ${restaurant.address}` : ""}
        </p>
        <RestaurantContact restaurant={restaurant} />
        <EvaluationBars evaluations={recommendation.evaluations} names={names} />
        {recommendation.rejected ? (
          <div>
            <p>{recommendation.rejectionSummary}</p>
            {rejectionReasons.length ? (
              <div className="rejection-details">
                <h3>Why it was set aside</h3>
                <ul className="rejection-reason-list">
                  {rejectionReasons.map((reason, index) => (
                    <li key={`${reason.participantId}-${reason.constraintType}-${index}`}>
                      <p>{reason.summary}</p>
                      <dl className="rejection-vars">
                        <div>
                          <dt>From</dt>
                          <dd>
                            {names.get(reason.participantId) ?? "Member"} · {reason.priority.toLowerCase()}
                          </dd>
                        </div>
                        <div>
                          <dt>Limit</dt>
                          <dd>{formatReasonValue(reason.constraintType, reason.required)}</dd>
                        </div>
                        <div>
                          <dt>This restaurant</dt>
                          <dd>{formatReasonValue(reason.constraintType, reason.actual)}</dd>
                        </div>
                      </dl>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <div>
            <h3>Why it works</h3>
            <ul>
              {recommendation.explanations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {children}
        <RestaurantExtraDetails restaurant={restaurant} />
      </div>
    </article>
  );
}
