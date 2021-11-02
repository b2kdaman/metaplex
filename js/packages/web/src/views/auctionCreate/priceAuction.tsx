import { Button, Col, Input, Row } from 'antd';
import React from 'react';
import { AuctionCategory, AuctionState } from '.';

export const PriceAuction = (props: {
  attributes: AuctionState;
  setAttributes: (attr: AuctionState) => void;
  confirm: () => void;
}) => {
  return (
    <>
      <Row>
        <h2>Price</h2>
        <p>Set the price for your auction.</p>
      </Row>
      <Row>
        <Col xl={24}>
          {props.attributes.category === AuctionCategory.Open && (
            <label>
              <span>Price</span>
              <span>
                This is the fixed price that everybody will pay for your
                Participation NFT.
              </span>
              <Input
                type="number"
                min={0}
                autoFocus
                placeholder="Fixed Price"
                prefix="◎"
                suffix="SOL"
                onChange={info =>
                  props.setAttributes({
                    ...props.attributes,
                    // Do both, since we know this is the only item being sold.
                    participationFixedPrice: parseFloat(info.target.value),
                    priceFloor: parseFloat(info.target.value),
                  })
                }
              />
            </label>
          )}
          {props.attributes.category !== AuctionCategory.Open && (
            <label>
              <span>Price Floor</span>
              <span>This is the starting bid price for your auction.</span>
              <Input
                type="number"
                min={0}
                autoFocus
                placeholder="Price"
                prefix="◎"
                suffix="SOL"
                onChange={info =>
                  props.setAttributes({
                    ...props.attributes,
                    priceFloor: parseFloat(info.target.value),
                  })
                }
              />
            </label>
          )}
          <label>
            <span>Tick Size</span>
            <span>All bids must fall within this price increment.</span>
            <Input
              type="number"
              min={0}
              placeholder="Tick size in SOL"
              prefix="◎"
              suffix="SOL"
              onChange={info =>
                props.setAttributes({
                  ...props.attributes,
                  priceTick: parseFloat(info.target.value),
                })
              }
            />
          </label>
        </Col>
      </Row>
      <Row>
        <Button type="primary" size="large" onClick={props.confirm}>
          Continue
        </Button>
      </Row>
    </>
  );
};
