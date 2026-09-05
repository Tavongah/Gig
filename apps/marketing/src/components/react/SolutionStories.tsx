import { photos } from "../../data/photos";
import { PhotoStory } from "./PhotoStory";
import "../../styles/home.css";

function ChatDemo() {
  return (
    <div className="duts-ui-card" aria-hidden="true">
      <div className="duts-ui-card__head">
        <strong>Northstar Heating</strong>
        <span>AI Customer Assistant</span>
      </div>
      <div className="duts-chat">
        <div className="duts-chat__bubble duts-chat__bubble--in">
          Do you install heat pumps?
        </div>
        <div className="duts-chat__bubble duts-chat__bubble--out">
          Yes. We install and service heat pumps. Would you like an estimate or schedule a consultation?
        </div>
        <div className="duts-chat__actions">
          <span>Get Estimate</span>
          <span>Book Consultation</span>
        </div>
      </div>
    </div>
  );
}

function LeadDemo() {
  return (
    <div className="duts-ui-card" aria-hidden="true">
      <div className="duts-ui-card__head">
        <strong>Incoming lead</strong>
        <span>James M.</span>
      </div>
      <p className="duts-ui-card__quote">“Need an AC repair today.”</p>
      <ul className="duts-ui-meta">
        <li>
          <span>Urgency</span>
          <strong>High</strong>
        </li>
        <li>
          <span>Location</span>
          <strong>4.2 mi</strong>
        </li>
        <li>
          <span>Service</span>
          <strong>AC Repair</strong>
        </li>
        <li>
          <span>Appointment</span>
          <strong>2:30 PM</strong>
        </li>
      </ul>
      <div className="duts-pipeline">
        <span className="is-done">New</span>
        <span className="is-done">Contacted</span>
        <span className="is-active">Qualified</span>
        <span>Booked</span>
      </div>
    </div>
  );
}

function DocDemo() {
  return (
    <div className="duts-ui-card" aria-hidden="true">
      <div className="duts-ui-card__head">
        <strong>Document AI</strong>
        <span>17 documents received</span>
      </div>
      <ul className="duts-extract">
        <li>
          Invoice number <em>✓</em>
        </li>
        <li>
          Supplier <em>✓</em>
        </li>
        <li>
          Amount <em>✓</em>
        </li>
        <li>
          Due date <em>✓</em>
        </li>
      </ul>
    </div>
  );
}

function WhatsAppDemo() {
  return (
    <div className="duts-ui-card duts-ui-card--wa" aria-hidden="true">
      <div className="duts-ui-card__head">
        <strong>WhatsApp</strong>
        <span>Harbor Dental · demo</span>
      </div>
      <div className="duts-chat">
        <div className="duts-chat__bubble duts-chat__bubble--in">Are you available Saturday?</div>
        <div className="duts-chat__bubble duts-chat__bubble--out">
          Yes. We have availability at 10:00 AM and 1:30 PM.
        </div>
        <div className="duts-chat__actions">
          <span>Book appointment</span>
        </div>
      </div>
    </div>
  );
}

export function SolutionStories() {
  return (
    <>
      <PhotoStory
        image={photos.homeServices}
        alt="Home-service technician working on equipment"
        eyebrow="AI Customer Assistant"
        title="Answer customers even when your team can't."
        copy="Train DUTS on your services, pricing and FAQs — then let it handle website chat, WhatsApp and common questions with a clean handoff when a human is needed."
        tone="dark"
      >
        <ChatDemo />
      </PhotoStory>

      <PhotoStory
        image={photos.phoneCheck}
        alt="Business owner checking a phone while working"
        eyebrow="AI Lead Assistant"
        title="Turn more enquiries into customers."
        copy="Capture the lead, respond immediately, qualify urgency and route the right next step — without waiting for someone to notice the inbox."
        reverse
        tone="light"
      >
        <LeadDemo />
      </PhotoStory>

      <PhotoStory
        image={photos.documents}
        alt="Professional reviewing business documents at a desk"
        eyebrow="AI Document Intelligence"
        title="Spend less time reading everything by hand."
        copy="Summarize, extract and search invoices, contracts and reports so your team gets answers instead of another pile of files."
        tone="dark"
      >
        <DocDemo />
      </PhotoStory>

      <PhotoStory
        image={photos.leadOwner}
        alt="Small-business owner at work with a phone nearby"
        eyebrow="Always-on conversations"
        title="Meet customers where they already message you."
        copy="Example workflows show how DUTS can continue a conversation, offer times and help book — using your real availability rules when connected."
        reverse
        tone="light"
      >
        <WhatsAppDemo />
      </PhotoStory>
    </>
  );
}
