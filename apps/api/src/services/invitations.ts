export interface EmailInvitation {
  destination: string;
  eventName: string;
  inviterName: string;
  url: string;
}

export interface SmsInvitation {
  destination: string;
  eventName: string;
  url: string;
}

export interface InvitationSender {
  sendEmail(invitation: EmailInvitation): Promise<void>;
  sendSms(invitation: SmsInvitation): Promise<void>;
}

export class DevInvitationSender implements InvitationSender {
  readonly sent: EmailInvitation[] = [];

  async sendEmail(invitation: EmailInvitation): Promise<void> {
    this.sent.push(invitation);
    console.log(
      `\nDEV INVITATION\n${invitation.destination}:\n${invitation.url}\n`
    );
  }

  async sendSms(invitation: SmsInvitation): Promise<void> {
    console.log(`\nDEV SMS INVITATION\n${invitation.destination}:\n${invitation.url}\n`);
  }
}
