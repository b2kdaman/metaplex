import { StringPublicKey } from '@oyster/common';
import { Button } from 'antd';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { Confetti } from '../../components/Confetti';

export const Congrats = (props: {
  auction?: {
    vault: StringPublicKey;
    auction: StringPublicKey;
    auctionManager: StringPublicKey;
  };
}) => {
  const history = useHistory();

  const newTweetURL = () => {
    const params = {
      text: "I've created a new NFT auction on Metaplex, check it out!",
      url: `${window.location.origin
        }/#/auction/${props.auction?.auction.toString()}`,
      hashtags: 'NFT,Crypto,Metaplex',
      // via: "Metaplex",
      related: 'Metaplex,Solana',
    };
    const queryParams = new URLSearchParams(params).toString();
    return `https://twitter.com/intent/tweet?${queryParams}`;
  };

  return (
    <>
      <div>Congratulations! Your auction is now live.</div>
      <div>
        <Button onClick={() => window.open(newTweetURL(), '_blank')}>
          <span>Share it on Twitter</span>
          <span>&gt;</span>
        </Button>
        <Button
          onClick={() =>
            history.push(`/auction/${props.auction?.auction.toString()}`)
          }
        >
          <span>See it in your auctions</span>
          <span>&gt;</span>
        </Button>
      </div>
      <Confetti />
    </>
  );
};
